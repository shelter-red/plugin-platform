import { strict as assert } from 'node:assert'
import { runScheduledMaintenance } from './src/index.ts'
import type { Env } from './src/types.ts'

type ExecutedQuery = { sql: string; values: unknown[] }

const executed: ExecutedQuery[] = []
const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (sql.includes('FROM request_logs')) {
          executed.push({ sql, values })
          return { count: 12 } as T
        }
        return null as T
      },
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => {
        executed.push({ sql, values })
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const before = Date.now()
await runScheduledMaintenance({ DB: database, BLOB_BUCKET: { delete: async () => undefined } } as unknown as Env)
const after = Date.now()

const find = (fragment: string) => {
  const query = executed.find((entry) => entry.sql.includes(fragment))
  assert.ok(query, `missing scheduled query: ${fragment}`)
  return query
}

const expectAge = (value: unknown, days: number) => {
  assert.equal(typeof value, 'string')
  const timestamp = Date.parse(String(value))
  const expectedAge = days * 24 * 60 * 60 * 1000
  assert.ok(timestamp >= before - expectedAge - 1000)
  assert.ok(timestamp <= after - expectedAge + 1000)
}

const snapshot = find('INSERT INTO usage_snapshots')
assert.equal(snapshot.values.length, 3)
assert.equal(snapshot.values[1], 12)
assert.equal(snapshot.values[2], 'global')
assert.match(find('SELECT COUNT(*) AS count FROM request_logs').sql, /created_at > \? AND created_at <= \?/)
expectAge(find('DELETE FROM usage_snapshots').values[0], 30)
expectAge(find('DELETE FROM request_logs').values[0], 30)
expectAge(find('DELETE FROM audit_log').values[0], 180)

for (const table of ['sessions', 'registration_codes']) {
  const cleanup = find(`DELETE FROM ${table}`)
  const timestamp = Date.parse(String(cleanup.values[0]))
  assert.ok(timestamp >= before && timestamp <= after)
}

console.log('scheduled maintenance retention smoke test passed')
