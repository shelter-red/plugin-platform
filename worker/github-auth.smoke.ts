import { strict as assert } from 'node:assert'
import { upsertGithubUser } from './src/auth.ts'
import type { Env } from './src/types.ts'

type UserRow = { id: string; github_id: string; email: string; display_name: string; role: string }
const users = new Map<string, UserRow>()
const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      run: async () => {
        if (sql.includes('INSERT INTO users')) {
          const [id, githubId, email, displayName, role] = values as [string, string, string, string, string]
          const existing = users.get(githubId)
          users.set(githubId, { id: existing?.id ?? id, github_id: githubId, email, display_name: displayName, role })
        }
        return { meta: { changes: 1 } }
      },
      first: async <T>() => {
        const githubId = values[0] as string
        return (users.get(githubId) ?? null) as T
      },
    }
    return query
  },
}
const env = { DB: database } as unknown as Env
const firstIdentity = { githubId: 'github-1', emails: ['alice@example.test'], displayName: 'Alice' }
const secondIdentity = { githubId: 'github-1', emails: ['alice@new.example.test'], displayName: 'Alice Updated' }

const [firstId, secondId] = await Promise.all([
  upsertGithubUser(env, firstIdentity, 'member'),
  upsertGithubUser(env, secondIdentity, 'member'),
])
assert.equal(firstId, secondId)
assert.equal(users.size, 1)
assert.deepEqual(users.get('github-1'), {
  id: firstId,
  github_id: 'github-1',
  email: 'alice@new.example.test',
  display_name: 'Alice Updated',
  role: 'member',
})
console.log('GitHub user upsert smoke test passed')
