import { strict as assert } from 'node:assert'
import { claimInvite } from './src/auth.ts'
import type { Env } from './src/types.ts'

let status = 'pending'
const database = {
  prepare(sql: string) {
    const query = {
      bind: (..._values: unknown[]) => query,
      first: async <T>() => sql.includes('FROM invites') && status === 'pending' ? { id: 'invite-1', email: 'alice@example.test', github_login: 'alice' } as T : null,
      run: async () => {
        if (!sql.includes('UPDATE invites') || status !== 'pending') return { meta: { changes: 0 } }
        status = 'used'
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}
const env = { DB: database } as unknown as Env

assert.equal(await claimInvite(env, 'invite-hash', { login: 'alice', emails: ['alice@example.test'] }), true)
assert.equal(status, 'used')
status = 'pending'
assert.equal(await claimInvite(env, 'invite-hash', { login: 'alice', emails: ['other@example.test'] }), false)
assert.equal(status, 'pending')
status = 'pending'
const [first, second] = await Promise.all([
  claimInvite(env, 'invite-hash', { login: 'alice', emails: ['alice@example.test'] }),
  claimInvite(env, 'invite-hash', { login: 'alice', emails: ['alice@example.test'] }),
])
assert.deepEqual([first, second].sort(), [false, true])
assert.equal(status, 'used')
console.log('invite claim smoke test passed')
