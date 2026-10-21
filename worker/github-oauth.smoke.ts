import { strict as assert } from 'node:assert'
import worker from './src/index.ts'
import type { Env } from './src/types.ts'

type GithubUser = { githubId: string; login: string; email: string; displayName: string; role: string }

const oauthStates = new Map<string, { inviteTokenHash: string | null }>()
const users = new Map<string, GithubUser>()
const sessions: string[] = []
let activeIdentity = { githubId: '42', login: 'alice', email: 'alice@example.test', displayName: 'Alice' }

const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (sql.includes('FROM oauth_states')) {
          const row = oauthStates.get(values[0] as string)
          return (row ? { state_hash: values[0], invite_token_hash: row.inviteTokenHash } : null) as T
        }
        if (sql.includes('SELECT id FROM users WHERE github_id')) {
          const user = users.get(values[0] as string)
          return (user ? { id: user.githubId } : null) as T
        }
        return null as T
      },
      run: async () => {
        if (sql.includes('INSERT INTO oauth_states')) {
          oauthStates.set(values[0] as string, { inviteTokenHash: values[1] as string | null })
          return { meta: { changes: 1 } }
        }
        if (sql.includes('DELETE FROM oauth_states')) {
          const deleted = oauthStates.delete(values[0] as string)
          return { meta: { changes: deleted ? 1 : 0 } }
        }
        if (sql.includes('INSERT INTO users')) {
          const [, githubId, email, displayName, role] = values as [string, string, string, string, string]
          users.set(githubId, { githubId, login: githubId === '42' ? 'alice' : 'bob', email, displayName, role })
          return { meta: { changes: 1 } }
        }
        if (sql.includes('INSERT INTO sessions')) {
          sessions.push(values[1] as string)
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const env = {
  DB: database,
  GITHUB_CLIENT_ID: 'github-client-id',
  GITHUB_CLIENT_SECRET: 'github-client-secret',
  GITHUB_REDIRECT_URI: 'https://console.example.test/auth/github/callback',
  GITHUB_ALLOWLIST: 'alice@example.test',
} as unknown as Env

const originalFetch = globalThis.fetch
const requests: string[] = []
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  requests.push(url)
  if (url.endsWith('/login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'github-access-token' }), { status: 200 })
  if (url.endsWith('/user')) return new Response(JSON.stringify({ id: Number(activeIdentity.githubId), login: activeIdentity.login, name: activeIdentity.displayName }), { status: 200 })
  if (url.endsWith('/user/emails')) return new Response(JSON.stringify([{ email: activeIdentity.email, primary: true, verified: true }]), { status: 200 })
  throw new Error(`unexpected GitHub request: ${url} ${String(init?.body ?? '')}`)
}

try {
  const start = await worker.fetch(new Request('https://console.example.test/auth/github/start'), env, {} as ExecutionContext)
  assert.equal(start.status, 302)
  const authorizeUrl = new URL(start.headers.get('location')!)
  assert.equal(authorizeUrl.origin, 'https://github.com')
  assert.equal(authorizeUrl.pathname, '/login/oauth/authorize')
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'github-client-id')
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), env.GITHUB_REDIRECT_URI)
  assert.equal(authorizeUrl.searchParams.get('scope'), 'read:user user:email')
  const state = authorizeUrl.searchParams.get('state')!
  assert.equal(state.length > 20, true)
  assert.equal(oauthStates.size, 1)

  const callback = await worker.fetch(new Request(`https://console.example.test/auth/github/callback?state=${encodeURIComponent(state)}&code=github-code`), env, {} as ExecutionContext)
  assert.equal(callback.status, 302)
  assert.equal(new URL(callback.headers.get('location')!, 'https://console.example.test').pathname, '/')
  assert.match(callback.headers.get('set-cookie') ?? '', /^plugmesh_session=/)
  assert.equal(oauthStates.size, 0)
  assert.equal(users.get('42')?.role, 'super_admin')
  assert.equal(sessions.length, 1)
  assert.deepEqual(requests, [
    'https://github.com/login/oauth/access_token',
    'https://api.github.com/user',
    'https://api.github.com/user/emails',
  ])

  const replay = await worker.fetch(new Request(`https://console.example.test/auth/github/callback?state=${encodeURIComponent(state)}&code=github-code`), env, {} as ExecutionContext)
  assert.equal(replay.status, 302)
  assert.match(new URL(replay.headers.get('location')!, 'https://console.example.test').searchParams.get('auth_error') ?? '', /状态已过期/)
  assert.equal(requests.length, 3)

  activeIdentity = { githubId: '43', login: 'bob', email: 'bob@example.test', displayName: 'Bob' }
  const rejectedStart = await worker.fetch(new Request('https://console.example.test/auth/github/start'), env, {} as ExecutionContext)
  const rejectedState = new URL(rejectedStart.headers.get('location')!, 'https://github.com').searchParams.get('state')!
  const rejected = await worker.fetch(new Request(`https://console.example.test/auth/github/callback?state=${encodeURIComponent(rejectedState)}&code=github-code`), env, {} as ExecutionContext)
  assert.equal(rejected.status, 302)
  assert.match(new URL(rejected.headers.get('location')!, 'https://console.example.test').searchParams.get('auth_error') ?? '', /未被邀请/)
  assert.equal(users.has('43'), false)
  assert.equal(sessions.length, 1)
} finally {
  globalThis.fetch = originalFetch
}

console.log('GitHub OAuth route smoke test passed')
