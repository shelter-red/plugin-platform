import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'

const ADMIN_TOKEN = 'cf-admin-session'
const MEMBER_TOKEN = 'cf-member-session'
const ACCESS_TOKEN = 'cloudflare-access-token-secret'
const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

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
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-cf-admin', 'gh-cf-admin', 'admin@example.com', 'CF Admin', 'super_admin', now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-cf-admin', 'user-cf-admin', await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-cf-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

beforeEach(async () => {
  await resetDatabase()
  await seedServer()
  await seedAccounts()
})

test('Cloudflare 凭据加密保存、账号脱敏且仅超级管理员可操作', { timeout: 20_000 }, async () => {
  const empty = await api('/api/settings/cloudflare', ADMIN_TOKEN)
  expect(empty.status).toBe(200)
  expect((await empty.json() as { configured: boolean }).configured).toBe(false)

  const saved = await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ accessToken: ACCESS_TOKEN, accountId: ACCOUNT_ID }) })
  expect(saved.status).toBe(200)
  const savedBody = await saved.json() as Record<string, unknown>
  expect(savedBody.configured).toBe(true)
  expect(savedBody.accountIdConfigured).toBe(true)
  expect(savedBody.accountId).toBe('0123...cdef')
  expect(savedBody).not.toHaveProperty('accessToken')

  const stored = await testEnv.DB.prepare('SELECT ciphertext, iv FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  expect(stored?.ciphertext).toBeTruthy()
  expect(stored?.ciphertext).not.toContain(ACCESS_TOKEN)
  expect(stored?.ciphertext).not.toContain(ACCOUNT_ID)

  const read = await api('/api/settings/cloudflare', ADMIN_TOKEN)
  expect(read.status).toBe(200)
  const readBody = await read.json() as Record<string, unknown>
  expect(readBody.configured).toBe(true)
  expect(readBody.accountId).toBe('0123...cdef')
  expect(readBody).not.toHaveProperty('accessToken')

  expect((await api('/api/settings/cloudflare', MEMBER_TOKEN)).status).toBe(403)
  expect((await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({}) })).status).toBe(400)

  const removed = await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'DELETE' })
  expect(removed.status).toBe(200)
  expect((await removed.json() as { configured: boolean }).configured).toBe(false)
  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'cloudflare.credentials.%' ORDER BY rowid").all<{ action: string; detail_json: string }>()
  expect(audit.results.map((row) => row.action)).toEqual(['cloudflare.credentials.updated', 'cloudflare.credentials.revoked'])
  expect(audit.results.some((row) => row.detail_json.includes(ACCESS_TOKEN))).toBe(false)
})
