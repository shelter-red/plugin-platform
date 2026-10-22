import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { cloudflareUsageApi } from '../src/index'
import { decryptSecret, encryptSecret } from '../src/secrets'
import type { AuthenticatedUser } from '../src/types'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'
import { CLOUDFLARE_STUB_ACCOUNT_ID, CLOUDFLARE_STUB_REFRESHED_TOKEN } from './outbound-stub'

const ADMIN_TOKEN = 'cf-oauth-admin-session'
const admin: AuthenticatedUser = { id: 'user-cf-oauth-admin', github_id: 'gh-cf-oauth-admin', email: 'admin@example.com', display_name: 'CF OAuth Admin', role: 'super_admin' }

const api = (path: string, token: string): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, { headers: { cookie: `plugmesh_session=${token}` }, redirect: 'manual' })

async function seedAdmin(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(admin.id, admin.github_id, admin.email, admin.display_name, admin.role, now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-cf-oauth-admin', admin.id, await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

async function storeCredential(credential: Record<string, unknown>): Promise<void> {
  const sealed = await encryptSecret(testEnv.SESSION_SECRET!, JSON.stringify(credential))
  await testEnv.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, new Date().toISOString()).run()
}

async function readCredential(): Promise<Record<string, unknown> & { accessToken: string; refreshToken?: string; expiresAt?: string | null }> {
  const stored = await testEnv.DB.prepare('SELECT ciphertext, iv FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  return JSON.parse(await decryptSecret(testEnv.SESSION_SECRET!, stored!.ciphertext, stored!.iv)) as Record<string, unknown> & { accessToken: string }
}

const requestsPayload = { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 4321 } }] }] } } }
const resourcesPayload = { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 3, writeQueries: 2 } }] }] } } }

function analyticsFetcher(calls: string[], rejectToken?: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    const authorization = request.headers.get('authorization') ?? ''
    calls.push(authorization)
    if (rejectToken && authorization === `Bearer ${rejectToken}`) return new Response('unauthorized', { status: 401 })
    const query = (JSON.parse(await request.text()) as { query: string }).query
    return Response.json(query.includes('ResourceUsage(') ? resourcesPayload : requestsPayload)
  }) as typeof fetch
}

beforeEach(async () => {
  await resetDatabase()
  await seedServer()
  await seedAdmin()
})

test('Cloudflare OAuth 回调兑换令牌、自动发现账号并加密保存', { timeout: 20_000 }, async () => {
  const started = await api('/auth/cloudflare/start', ADMIN_TOKEN)
  expect(started.status).toBe(302)
  const authorizeUrl = new URL(started.headers.get('location') ?? '')
  expect(authorizeUrl.origin).toBe('https://dash.cloudflare.com')
  expect(authorizeUrl.searchParams.get('client_id')).toBe('cf-test-client')
  expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('https://console.example.com/auth/cloudflare/callback')
  expect(authorizeUrl.searchParams.get('scope')).toBe('account-settings.read account-analytics.read offline_access')
  const state = authorizeUrl.searchParams.get('state') ?? ''
  expect(state).not.toBe('')
  const pendingStates = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM cloudflare_oauth_states').first<{ count: number }>()
  expect(pendingStates?.count).toBe(1)

  const callback = await api(`/auth/cloudflare/callback?code=cf-code&state=${encodeURIComponent(state)}`, ADMIN_TOKEN)
  // 回调始终 303 回系统设置页，结果放进一次性 Cookie，避免用户被丢到首页或读到 URL 里的错误句。
  expect(callback.status).toBe(303)
  expect(callback.headers.get('location')).toBe('https://console.example.com/settings')
  const authCookie = callback.headers.get('set-cookie') ?? ''
  expect(authCookie).toContain('plugmesh_cf_auth=')
  const resultCookie = decodeURIComponent(authCookie.split(';')[0]!.slice('plugmesh_cf_auth='.length))
  expect(JSON.parse(resultCookie)).toEqual({ kind: 'success', accountConfigured: true })

  const stored = await testEnv.DB.prepare('SELECT ciphertext FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string }>()
  expect(stored?.ciphertext).not.toContain('cf-access-cf-code')
  const credential = await readCredential()
  expect(credential.accessToken).toBe('cf-access-cf-code')
  expect(credential.refreshToken).toBe('refresh-ok')
  expect(credential.accountId).toBe(CLOUDFLARE_STUB_ACCOUNT_ID)
  const consumed = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM cloudflare_oauth_states').first<{ count: number }>()
  expect(consumed?.count).toBe(0)
  const audit = await testEnv.DB.prepare("SELECT detail_json FROM audit_log WHERE action = 'cloudflare.oauth.connected'").first<{ detail_json: string }>()
  expect(JSON.parse(audit?.detail_json ?? '{}').accountIdConfigured).toBe(true)

  const replay = await api(`/auth/cloudflare/callback?code=cf-code&state=${encodeURIComponent(state)}`, ADMIN_TOKEN)
  expect(replay.status).toBe(303)
  expect(replay.headers.get('location')).toBe('https://console.example.com/settings')
  const replayCookie = decodeURIComponent((replay.headers.get('set-cookie') ?? '').split(';')[0]!.slice('plugmesh_cf_auth='.length))
  expect(JSON.parse(replayCookie)).toEqual({ kind: 'error', code: 'state_expired', description: null })
  expect((await readCredential()).accessToken).toBe('cf-access-cf-code')
})

test('临近过期的 Cloudflare 凭据在查询用量前自动刷新并落库', { timeout: 20_000 }, async () => {
  await storeCredential({ accessToken: 'cf-access-old', refreshToken: 'refresh-ok', accountId: CLOUDFLARE_STUB_ACCOUNT_ID, expiresAt: new Date(Date.now() - 60_000).toISOString() })
  const calls: string[] = []
  const response = await cloudflareUsageApi(testEnv, admin, analyticsFetcher(calls))
  expect(response.status).toBe(200)
  expect(calls).toEqual([`Bearer ${CLOUDFLARE_STUB_REFRESHED_TOKEN}`, `Bearer ${CLOUDFLARE_STUB_REFRESHED_TOKEN}`])
  const credential = await readCredential()
  expect(credential.accessToken).toBe(CLOUDFLARE_STUB_REFRESHED_TOKEN)
  expect(credential.refreshToken).toBe('refresh-ok-next')
  expect(Date.parse(credential.expiresAt ?? '')).toBeGreaterThan(Date.now())
  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'cloudflare.oauth.refreshed'").first<{ count: number }>()
  expect(audit?.count).toBe(1)
})

test('Cloudflare Analytics 返回 401 时刷新令牌并重试一次', { timeout: 20_000 }, async () => {
  await storeCredential({ accessToken: 'cf-access-stale', refreshToken: 'refresh-ok', accountId: CLOUDFLARE_STUB_ACCOUNT_ID })
  const calls: string[] = []
  const response = await cloudflareUsageApi(testEnv, admin, analyticsFetcher(calls, 'cf-access-stale'))
  expect(response.status).toBe(200)
  expect(calls).toEqual([
    'Bearer cf-access-stale',
    `Bearer ${CLOUDFLARE_STUB_REFRESHED_TOKEN}`,
    `Bearer ${CLOUDFLARE_STUB_REFRESHED_TOKEN}`,
  ])
  expect((await readCredential()).accessToken).toBe(CLOUDFLARE_STUB_REFRESHED_TOKEN)
  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'cloudflare.oauth.refreshed'").first<{ count: number }>()
  expect(audit?.count).toBe(1)
})

test('Cloudflare 令牌刷新失败时返回 502 且不改动已存凭据', { timeout: 20_000 }, async () => {
  await storeCredential({ accessToken: 'cf-access-old', refreshToken: 'refresh-bad', accountId: CLOUDFLARE_STUB_ACCOUNT_ID, expiresAt: new Date(Date.now() - 60_000).toISOString() })
  const calls: string[] = []
  const response = await cloudflareUsageApi(testEnv, admin, analyticsFetcher(calls))
  expect(response.status).toBe(502)
  expect((await response.json() as { error: string }).error).toBe('Cloudflare OAuth token refresh failed')
  expect(calls).toEqual([])
  const credential = await readCredential()
  expect(credential.accessToken).toBe('cf-access-old')
  expect(credential.refreshToken).toBe('refresh-bad')
  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'cloudflare.oauth.refreshed'").first<{ count: number }>()
  expect(audit?.count).toBe(0)
})

test('授权结果经一次性 Cookie 读回并立即清除', { timeout: 20_000 }, async () => {
  const cookieValue = encodeURIComponent(JSON.stringify({ kind: 'error', code: 'invalid_scope', description: 'scope not allowed' }))
  const response = await SELF.fetch('https://console.example.com/api/settings/cloudflare/auth-result', { headers: { cookie: `plugmesh_session=${ADMIN_TOKEN}; plugmesh_cf_auth=${cookieValue}` } })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('set-cookie')).toContain('plugmesh_cf_auth=;')
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  expect(await response.json()).toEqual({ result: { kind: 'error', code: 'invalid_scope', description: 'scope not allowed' } })

  const empty = await SELF.fetch('https://console.example.com/api/settings/cloudflare/auth-result', { headers: { cookie: `plugmesh_session=${ADMIN_TOKEN}` } })
  expect(await empty.json()).toEqual({ result: null })
})
