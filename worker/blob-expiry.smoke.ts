import { strict as assert } from 'node:assert'
import { runScheduledMaintenance } from './src/index.ts'
import type { Env } from './src/types.ts'

type Row = { id: string; object_key: string; size_bytes: number; consumed_at?: string }

const expired: Row[] = [
  { id: 'obj-ok', object_key: 'blob-ok', size_bytes: 100 },
  { id: 'obj-retry', object_key: 'blob-retry', size_bytes: 200 },
  { id: 'obj-fail', object_key: 'blob-fail', size_bytes: 300 },
  { id: 'obj-race', object_key: 'blob-race', size_bytes: 400 },
]
const stale: Row[] = [
  { id: 'stale-ok', object_key: 'blob-stale', size_bytes: 500, consumed_at: '2026-10-19T00:00:00.000Z' },
  { id: 'stale-fail', object_key: 'blob-stale-fail', size_bytes: 600, consumed_at: '2026-10-19T00:00:00.000Z' },
]

const executed: { sql: string; values: unknown[] }[] = []
const selected: { sql: string; values: unknown[] }[] = []
const consumedChanges: Record<string, number> = { 'obj-ok': 1, 'obj-retry': 1, 'obj-fail': 1, 'obj-race': 0 }

const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => null as T,
      all: async <T>() => {
        selected.push({ sql, values })
        if (sql.includes('FROM temp_objects WHERE consumed_at IS NULL AND expires_at <=')) return { results: expired as unknown as T[] }
        if (sql.includes('FROM temp_objects WHERE consumed_at IS NOT NULL AND consumed_at <')) return { results: stale as unknown as T[] }
        return { results: [] as T[] }
      },
      run: async () => {
        executed.push({ sql, values })
        if (sql.includes('UPDATE temp_objects SET consumed_at = ? WHERE id = ?')) {
          return { meta: { changes: consumedChanges[String(values[1])] ?? 1 } }
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const deleteAttempts: Record<string, number> = {}
const bucket = {
  delete: async (key: string) => {
    deleteAttempts[key] = (deleteAttempts[key] ?? 0) + 1
    if (key === 'blob-retry' && deleteAttempts[key] < 3) throw new Error('transient R2 failure')
    if (key === 'blob-fail' || key === 'blob-stale-fail') throw new Error('permanent R2 failure')
  },
}

const before = Date.now()
await runScheduledMaintenance({ DB: database, BLOB_BUCKET: bucket } as unknown as Env)
const after = Date.now()

const statements = (fragment: string) => executed.filter((entry) => entry.sql.includes(fragment))
const forId = (fragment: string, id: string) => statements(fragment).filter((entry) => entry.values.includes(id))

assert.equal(deleteAttempts['blob-ok'], 1, 'expired object is deleted once')
assert.equal(deleteAttempts['blob-retry'], 3, 'transient R2 failure is retried')
assert.equal(deleteAttempts['blob-fail'], 3, 'permanent R2 failure stops after three attempts')
assert.equal(deleteAttempts['blob-race'], undefined, 'already consumed object is skipped')
assert.equal(deleteAttempts['blob-stale'], 1, 'stale consumed object is deleted')
assert.equal(deleteAttempts['blob-stale-fail'], 3, 'stale object keeps retrying up to three attempts')

for (const id of ['obj-ok', 'obj-retry', 'obj-fail']) {
  assert.equal(forId('UPDATE temp_objects SET consumed_at = ? WHERE id = ?', id).length, 1, `${id} is claimed once`)
}
assert.equal(forId('UPDATE temp_objects SET consumed_at = ? WHERE id = ?', 'obj-race').length, 1, 'race row claim is attempted')
assert.equal(forId('UPDATE temp_objects SET consumed_at = NULL WHERE id = ?', 'obj-fail').length, 1, 'failed R2 delete restores the claim')
assert.equal(forId('UPDATE temp_objects SET consumed_at = NULL WHERE id = ?', 'obj-ok').length, 0, 'successful delete keeps the claim')

const deletedIds = statements('DELETE FROM temp_objects').map((entry) => String(entry.values[0]))
assert.deepEqual(deletedIds.sort(), ['obj-ok', 'obj-retry', 'stale-ok'])

const released = statements('UPDATE platform_usage').map((entry) => entry.values[0])
assert.deepEqual(released.sort(), [100, 200, 500], 'only deleted objects release R2 usage')

const staleSelect = selected.find((entry) => entry.sql.includes('consumed_at IS NOT NULL AND consumed_at <'))
assert.ok(staleSelect, 'stale consumed objects are queried')
const cutoff = Date.parse(String(staleSelect.values[0]))
assert.ok(cutoff >= before - 86_400_000 - 1_000 && cutoff <= after - 86_400_000 + 1_000, 'stale cutoff is 24 hours')
console.log('blob expiry smoke test passed')
