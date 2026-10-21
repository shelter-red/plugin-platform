import { strict as assert } from 'node:assert'
import { createServerRegistration } from './src/index.ts'
import type { Env } from './src/types.ts'

let used = false
let serverInserts = 0
const database = {
  prepare() {
    return { bind: () => ({}) }
  },
  batch: async (statements: unknown[]) => {
    const changes = used ? 0 : 1
    if (changes === 1) {
      used = true
      serverInserts += 1
    }
    return statements.map(() => ({ meta: { changes } }))
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
