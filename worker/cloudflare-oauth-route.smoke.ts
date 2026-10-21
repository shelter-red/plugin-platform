import { strict as assert } from 'node:assert'
import worker from './src/index.ts'
import { digest } from './src/auth.ts'
import { decryptSecret } from './src/secrets.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

type StoredCredential = { ciphertext: string; iv: string; updated_at: string }
const admin: AuthenticatedUser = { id: 'admin-1', github_id: 'github-admin', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const member: AuthenticatedUser = { id: 'member-1', github_id: 'github-member', email: 'member@example.test', display_name: 'Member', role: 'member' }
const users = new Map([[admin.id, admin], [member.id, member]])
const sessions = new Map<string, string>()
const oauthStates = new Map<string, string>()
const audits: string[] = []
let credential: StoredCredential | null = null

const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (sql.includes('FROM sessions')) return (sessions.get(values[0] as string) ? { user_id: sessions.get(values[0] as string) } : null) as T
        if (sql.includes('FROM users WHERE id')) return (users.get(values[0] as string) ?? null) as T
        if (sql.includes('FROM cloudflare_oauth_states')) {
          const userId = oauthStates.get(values[0] as string)
          return (userId === values[1] ? { state_hash: values[0], user_id: userId } : null) as T
        }
        return null as T
      },
      run: async () => {
        if (sql.includes('INSERT INTO cloudflare_oauth_states')) {
          oauthStates.set(values[0] as string, values[1] as string)
          return { meta: { changes: 1 } }
        }
        if (sql.includes('DELETE FROM cloudflare_oauth_states')) {
          const deleted = oauthStates.delete(values[0] as string)
          return { meta: { changes: deleted ? 1 : 0 } }
        }
        if (sql.includes('INSERT INTO cloudflare_credentials')) {
          credential = { ciphertext: values[1] as string, iv: values[2] as string, updated_at: values[3] as string }
          return { meta: { changes: 1 } }
        }
        if (sql.includes('INSERT INTO audit_log')) {
          audits.push(values[2] as string)
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
  SESSION_SECRET: 'route-smoke-session-secret',
  CLOUDFLARE_OAUTH_CLIENT_ID: 'cf-client-id',
  CLOUDFLARE_OAUTH_CLIENT_SECRET: 'cf-client-secret',
  CLOUDFLARE_OAUTH_REDIRECT_URI: 'https://console.example.test/auth/cloudflare/callback',
  CLOUDFLARE_OAUTH_SCOPE: 'workers-platform.read',
} as unknown as Env

const adminToken = 'admin-session-token'
const memberToken = 'member-session-token'
sessions.set(await digest(adminToken), admin.id)
sessions.set(await digest(memberToken), member.id)
const request = (path: string, token?: string) => new Request(`https://console.example.test${path}`, token ? { headers: { cookie: `plugmesh_session=${encodeURIComponent(token)}` } } : undefined)
const originalFetch = globalThis.fetch
const requests: string[] = []
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url
  requests.push(url)
  if (url.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'cf-access-token', refresh_token: 'cf-refresh-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200 })
  if (url.includes('/client/v4/accounts')) return new Response(JSON.stringify({ result: [{ id: 'account-1' }] }), { status: 200 })
  throw new Error(`unexpected Cloudflare request: ${url}`)
}

try {
  let response = await worker.fetch(request('/auth/cloudflare/start'), env, {} as ExecutionContext)
  assert.equal(response.status, 401)

  response = await worker.fetch(request('/auth/cloudflare/start', memberToken), env, {} as ExecutionContext)
  assert.equal(response.status, 403)

  response = await worker.fetch(request('/auth/cloudflare/start', adminToken), env, {} as ExecutionContext)
  assert.equal(response.status, 302)
  const authorizeUrl = new URL(response.headers.get('location')!)
  assert.equal(authorizeUrl.origin, 'https://dash.cloudflare.com')
  assert.equal(authorizeUrl.pathname, '/oauth2/auth')
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'cf-client-id')
  assert.equal(authorizeUrl.searchParams.get('scope'), 'workers-platform.read')
  const state = authorizeUrl.searchParams.get('state')!
  assert.equal(oauthStates.size, 1)

  response = await worker.fetch(request(`/auth/cloudflare/callback?state=${encodeURIComponent(state)}&code=cf-code`, adminToken), env, {} as ExecutionContext)
  assert.equal(response.status, 302)
  const resultLocation = new URL(response.headers.get('location')!, 'https://console.example.test')
  assert.equal(resultLocation.searchParams.get('cloudflare'), 'connected')
  assert.equal(oauthStates.size, 0)
  assert.deepEqual(requests, [
    'https://dash.cloudflare.com/oauth2/token',
    'https://api.cloudflare.com/client/v4/accounts?per_page=2',
  ])
  const stored = JSON.parse(await decryptSecret(env.SESSION_SECRET!, credential!.ciphertext, credential!.iv)) as { accessToken: string; refreshToken: string; tokenType: string; accountId: string; expiresAt: string }
  assert.equal(stored.accessToken, 'cf-access-token')
  assert.equal(stored.refreshToken, 'cf-refresh-token')
  assert.equal(stored.tokenType, 'Bearer')
  assert.equal(stored.accountId, 'account-1')
  assert.ok(Date.parse(stored.expiresAt) > Date.now())
  assert.deepEqual(audits, ['cloudflare.oauth.connected'])

  response = await worker.fetch(request(`/auth/cloudflare/callback?state=${encodeURIComponent(state)}&code=cf-code`, adminToken), env, {} as ExecutionContext)
  assert.equal(response.status, 302)
  assert.match(new URL(response.headers.get('location')!, 'https://console.example.test').searchParams.get('cloudflare_error') ?? '', /已过期或已使用/)
  assert.equal(requests.length, 2)
} finally {
  globalThis.fetch = originalFetch
}

console.log('Cloudflare OAuth route smoke test passed')
