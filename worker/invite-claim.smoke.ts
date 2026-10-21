import { strict as assert } from 'node:assert'
import { acceptInvite } from './src/auth.ts'
import type { Env } from './src/types.ts'

let status = 'pending'
const users = new Map<string, Record<string, unknown>>()

type Statement = { sql: string; values: unknown[] }
const database = {
  prepare(sql: string) {
    const query = {
      sql,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        query.values = values
        return query
      },
      async first<T>() {
        if (sql.includes('FROM invites')) {
          return status === 'pending' ? { id: 'invite-1', email: 'alice@example.test', github_login: 'alice' } as T : null
        }
        if (sql.includes('FROM users')) {
          const githubId = query.values[0]
          const user = [...users.values()].find((candidate) => candidate.github_id === githubId)
          return user ? { id: user.id } as T : null
        }
        throw new Error(`unexpected first query: ${sql}`)
      },
    }
    return query
  },
  async batch(statements: Statement[]) {
    if (status !== 'pending') return statements.map(() => ({ meta: { changes: 0 } }))
    const insert = statements.find((statement) => statement.sql.includes('INSERT INTO users'))
    const update = statements.find((statement) => statement.sql.includes('UPDATE invites'))
    assert.ok(insert)
    assert.ok(update)
    const [candidateId, githubId, email, displayName, role, createdAt] = insert.values
    users.set(String(githubId), { id: candidateId, github_id: githubId, email, display_name: displayName, role, created_at: createdAt })
    status = 'used'
    return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]
  },
}
const env = { DB: database } as unknown as Env
const identity = { githubId: 'github-alice', login: 'alice', emails: ['alice@example.test'], displayName: 'Alice' }

const userId = await acceptInvite(env, 'invite-hash', identity, 'member')
assert.equal(userId, users.get('github-alice')?.id)
assert.equal(status, 'used')
status = 'pending'
users.clear()
assert.equal(await acceptInvite(env, 'invite-hash', { ...identity, emails: ['other@example.test'] }, 'member'), null)
assert.equal(status, 'pending')

const [first, second] = await Promise.all([
  acceptInvite(env, 'invite-hash', identity, 'member'),
  acceptInvite(env, 'invite-hash', identity, 'member'),
])
assert.equal([first, second].filter(Boolean).length, 1)
assert.equal(users.size, 1)
assert.equal(status, 'used')
console.log('invite claim smoke test passed')
