import { strict as assert } from 'node:assert'
import { createServerRegistration } from './src/index.ts'
import type { Env } from './src/types.ts'

let used = false
let serverInserts = 0
const database = {
  prepare(sql: string) {
    const query = {
      bind: (..._values: unknown[]) => query,
      first: async <T>() => {
        if (sql.includes('FROM registration_codes')) return used ? null : { id: 'registration-1', user_id: 'user-1' } as T
        return null
      },
      run: async () => {
        if (sql.includes('UPDATE registration_codes')) {
          if (used) return { meta: { changes: 0 } }
          used = true
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
  batch: async (statements: unknown[]) => {
    serverInserts += statements.length > 0 ? 1 : 0
    return statements.map(() => ({ meta: { changes: 1 } }))
  },
}
const env = { DB: database } as unknown as Env
const code = 'one-time-code'
const [first, second] = await Promise.all([
  createServerRegistration(env, code, 'server-a'),
  createServerRegistration(env, code, 'server-b'),
])
const results = [first, second]
assert.equal(results.filter((result) => 'value' in result).length, 1)
assert.deepEqual(results.filter((result) => 'error' in result), [{ error: 'Registration code is invalid or expired', status: 401 }])
assert.equal(serverInserts, 1)
assert.equal(used, true)
console.log('registration code race smoke test passed')
