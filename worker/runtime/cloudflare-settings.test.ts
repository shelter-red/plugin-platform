import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { cloudflareSettingsApi } from '../src/index'
import { encryptSecret } from '../src/secrets'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import type { AuthenticatedUser, Env } from '../src/types'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'
import {
  CLOUDFLARE_STUB_ACCOUNT_ID,
  CLOUDFLARE_STUB_EMAIL,
  CLOUDFLARE_STUB_GLOBAL_API_KEY,
  CLOUDFLARE_STUB_INVALID_GLOBAL_API_KEY,
  CLOUDFLARE_STUB_MULTI_ACCOUNT_GLOBAL_API_KEY,
  CLOUDFLARE_STUB_PERMISSION_DENIED_GLOBAL_API_KEY,
  CLOUDFLARE_STUB_SECOND_ACCOUNT_ID,
} from './outbound-stub'

const ADMIN_TOKEN = 'cf-admin-session'
const MEMBER_TOKEN = 'cf-member-session'
const ADMIN: AuthenticatedUser = {
  id: 'user-cf-admin',
  email: 'admin@example.com',
  display_name: 'CF Admin',
  role: 'super_admin',
}

const api = (path: string, token: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, {
    ...init,
    headers: {
      cookie: `plugmesh_session=${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })

async function seedAccounts(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ADMIN.id, 'legacy-admin', ADMIN.email, ADMIN.display_name, ADMIN.role, now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-cf-admin', ADMIN.id, await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-cf-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

beforeEach(async () => {
  await resetDatabase()
  await seedServer()
  await seedAccounts()
  setPlatformSettingsCache(defaultPlatformSettings)
})

test('Cloudflare 设置 GET 不泄露凭据并限制为管理员访问', async () => {
  const empty = await api('/api/settings/cloudflare', ADMIN_TOKEN)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toEqual({
    configured: false,
    credentialKind: null,
    accountIdConfigured: false,
    accountId: null,
    email: null,
    updatedAt: null,
    lastVerifiedAt: null,
  })
  expect((await api('/api/settings/cloudflare', MEMBER_TOKEN)).status).toBe(403)
})

test('保存 Global API Key 前完成校验、加密落库、清缓存且不回显密钥', async () => {
  await testEnv.DB.prepare('INSERT INTO usage_cache (key, value_json, expires_at, updated_at) VALUES (?, ?, ?, ?)').bind(
    'cloudflare:workers',
    JSON.stringify({ configured: true, requests: 99 }),
    new Date(Date.now() + 60_000).toISOString(),
    new Date().toISOString(),
  ).run()

  const saved = await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_GLOBAL_API_KEY }),
  })
  expect(saved.status).toBe(200)
  const savedBody = await saved.json() as Record<string, unknown>
  expect(savedBody).toMatchObject({
    configured: true,
    credentialKind: 'global_api_key',
    accountIdConfigured: true,
    accountId: '0123...cdef',
    email: CLOUDFLARE_STUB_EMAIL,
  })
  expect(savedBody.lastVerifiedAt).toEqual(expect.any(String))
  expect(JSON.stringify(savedBody)).not.toContain(CLOUDFLARE_STUB_GLOBAL_API_KEY)

  const stored = await testEnv.DB.prepare('SELECT ciphertext, iv FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  expect(stored?.ciphertext).toBeTruthy()
  expect(stored?.ciphertext).not.toContain(CLOUDFLARE_STUB_GLOBAL_API_KEY)
  expect(stored?.ciphertext).not.toContain(CLOUDFLARE_STUB_ACCOUNT_ID)
  const cache = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM usage_cache WHERE key = ?').bind('cloudflare:workers').first<{ count: number }>()
  expect(cache?.count).toBe(0)

  const read = await api('/api/settings/cloudflare', ADMIN_TOKEN)
  const readBody = await read.json() as Record<string, unknown>
  expect(readBody.configured).toBe(true)
  expect(readBody.accountId).toBe('0123...cdef')
  expect(JSON.stringify(readBody)).not.toContain(CLOUDFLARE_STUB_GLOBAL_API_KEY)
  expect((await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({}) })).status).toBe(400)

  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'cloudflare.credentials.%' ORDER BY rowid").all<{ action: string; detail_json: string }>()
  expect(audit.results.map((row) => row.action)).toEqual(['cloudflare.credentials.updated'])
  expect(audit.results[0].detail_json).not.toContain(CLOUDFLARE_STUB_GLOBAL_API_KEY)
  expect(audit.results[0].detail_json).not.toContain(CLOUDFLARE_STUB_ACCOUNT_ID)

  const domain = await api('/api/settings/platform', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ pluginDomainSuffix: 'plugins.example.net' }),
  })
  expect(domain.status).toBe(200)
  expect(await domain.json()).toMatchObject({
    pluginDomainSuffix: '.plugins.example.net',
    cloudflareDomain: { zoneId: 'zone-runtime', zoneName: 'example.net', routePattern: '*.plugins.example.net/*' },
  })
})

test('Cloudflare 凭据、权限和账号错误返回真实 HTTP 与稳定错误码且不落库', async () => {
  const invalid = await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_INVALID_GLOBAL_API_KEY }),
  })
  expect(invalid.status).toBe(401)
  expect(await invalid.json()).toMatchObject({ code: 'credential_invalid' })

  const denied = await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_PERMISSION_DENIED_GLOBAL_API_KEY }),
  })
  expect(denied.status).toBe(403)
  expect(await denied.json()).toMatchObject({ code: 'credential_denied' })

  const ambiguous = await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_MULTI_ACCOUNT_GLOBAL_API_KEY }),
  })
  expect(ambiguous.status).toBe(409)
  expect(await ambiguous.json()).toMatchObject({ code: 'account_ambiguous' })

  const missing = await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_MULTI_ACCOUNT_GLOBAL_API_KEY, accountId: 'not-a-visible-account' }),
  })
  expect(missing.status).toBe(409)
  expect(await missing.json()).toMatchObject({ code: 'account_missing' })

  const selected = await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_MULTI_ACCOUNT_GLOBAL_API_KEY, accountId: CLOUDFLARE_STUB_SECOND_ACCOUNT_ID }),
  })
  expect(selected.status).toBe(200)
  expect(await selected.json()).toMatchObject({ accountId: 'fedc...3210' })

  const stored = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM cloudflare_credentials').first<{ count: number }>()
  expect(stored?.count).toBe(1)
})

test('未配置 Cloudflare 凭据时不能静默保存域名后缀', async () => {
  const response = await api('/api/settings/platform', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ pluginDomainSuffix: 'no-credential.example.net' }),
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'credential_required' })
})

test('旧格式凭据要求重新配置，不返回旧密钥', async () => {
  const legacy = await encryptSecret(testEnv.SESSION_SECRET!, JSON.stringify({
    accessToken: 'legacy-access-token',
    refreshToken: 'legacy-refresh-token',
    accountId: CLOUDFLARE_STUB_ACCOUNT_ID,
  }))
  await testEnv.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?)').bind('primary', legacy.ciphertext, legacy.iv, new Date().toISOString()).run()

  const response = await api('/api/settings/cloudflare', ADMIN_TOKEN)
  expect(response.status).toBe(409)
  const body = await response.json() as Record<string, unknown>
  expect(body).toMatchObject({ code: 'credential_unreadable' })
})

test('DELETE 只删除本地凭据和缓存，不调用 Cloudflare', async () => {
  await api('/api/settings/cloudflare', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_GLOBAL_API_KEY }),
  })
  const forbiddenFetch = (() => { throw new Error('DELETE must not call Cloudflare') }) as typeof fetch
  const response = await cloudflareSettingsApi(new Request('https://console.example.com/api/settings/cloudflare', { method: 'DELETE' }), testEnv, ADMIN, forbiddenFetch)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ configured: false, credentialKind: null })
  const stored = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM cloudflare_credentials').first<{ count: number }>()
  expect(stored?.count).toBe(0)
  const cache = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM usage_cache WHERE key = ?').bind('cloudflare:workers').first<{ count: number }>()
  expect(cache?.count).toBe(0)
})

test('缺失 SESSION_SECRET 时返回 HTTP 503 secret_missing', async () => {
  const envWithoutSecret = { ...testEnv, SESSION_SECRET: undefined } as Env
  const response = await cloudflareSettingsApi(new Request('https://console.example.com/api/settings/cloudflare'), envWithoutSecret, ADMIN)
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ code: 'secret_missing' })
})
