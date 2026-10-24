import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { decryptSecret } from '../src/secrets'
import type { AuthenticatedUser } from '../src/types'
import { hashToken, resetDatabase, testEnv } from './helpers'

const ADMIN_TOKEN = 'oauth-settings-admin-session'
const MEMBER_TOKEN = 'oauth-settings-member-session'
const admin: AuthenticatedUser = { id: 'user-oauth-settings-admin', github_id: 'gh-oauth-settings-admin', email: 'oauth-admin@example.com', display_name: 'OAuth Admin', role: 'super_admin' }
const member: AuthenticatedUser = { id: 'user-oauth-settings-member', github_id: 'gh-oauth-settings-member', email: 'oauth-member@example.com', display_name: 'OAuth Member', role: 'member' }

const api = (path: string, token: string, init?: RequestInit): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, { ...init, headers: { cookie: `plugmesh_session=${token}`, ...(init?.headers ?? {}) }, redirect: 'manual' })

async function seedUsers(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(admin.id, admin.github_id, admin.email, admin.display_name, admin.role, now),
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(member.id, member.github_id, member.email, member.display_name, member.role, now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-oauth-settings-admin', admin.id, await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-oauth-settings-member', member.id, await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

async function storedSecrets(): Promise<{ github?: { clientSecret?: string } }> {
  const row = await testEnv.DB.prepare('SELECT ciphertext, iv FROM oauth_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  return JSON.parse(await decryptSecret(testEnv.SESSION_SECRET!, row!.ciphertext, row!.iv)) as { github?: { clientSecret?: string } }
}

beforeEach(async () => {
  await resetDatabase()
  await seedUsers()
})

test('OAuth 配置仅超级管理员可读写，GET 不回显密钥，且响应中不再包含 Cloudflare OAuth', async () => {
  const forbidden = await api('/api/settings/oauth', MEMBER_TOKEN)
  expect(forbidden.status).toBe(403)
  expect((await api('/api/settings/oauth', MEMBER_TOKEN, { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(403)

  const initial = await api('/api/settings/oauth', ADMIN_TOKEN)
  expect(initial.status).toBe(200)
  const initialBody = await initial.json() as Record<string, unknown>
  expect(initialBody.github).toMatchObject({ configured: true, clientId: 'runtime-github-client', secretConfigured: true, source: 'environment' })
  expect(initialBody).not.toHaveProperty('cloudflare')

  const saved = await api('/api/settings/oauth', ADMIN_TOKEN, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ github: { clientId: 'db-github-client', clientSecret: 'db-github-secret', redirectUri: 'https://console.example.com/auth/github/callback', allowlist: 'runtime-admin, Admin@Example.com' } }),
  })
  expect(saved.status).toBe(200)
  const savedText = await saved.text()
  expect(savedText).not.toContain('db-github-secret')
  const savedBody = JSON.parse(savedText) as Record<string, unknown>
  expect(savedBody.github).toMatchObject({ configured: true, clientId: 'db-github-client', allowlist: 'runtime-admin, admin@example.com', source: 'database' })
  expect(savedBody).not.toHaveProperty('cloudflare')

  const row = await testEnv.DB.prepare('SELECT ciphertext FROM oauth_settings WHERE id = ?').bind('primary').first<{ ciphertext: string }>()
  expect(row?.ciphertext).not.toContain('db-github-secret')
  expect((await storedSecrets()).github?.clientSecret).toBe('db-github-secret')

  const start = await SELF.fetch('https://console.example.com/auth/github/start', { redirect: 'manual' })
  expect(start.status).toBe(302)
  const authorize = new URL(start.headers.get('location') ?? '')
  expect(authorize.searchParams.get('client_id')).toBe('db-github-client')
  expect(authorize.searchParams.get('redirect_uri')).toBe('https://console.example.com/auth/github/callback')
})

test('留空密钥时保留已有 GitHub 密钥，撤销后回退到环境变量配置', async () => {
  const first = await api('/api/settings/oauth', ADMIN_TOKEN, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ github: { clientId: 'db-github-client', clientSecret: 'db-github-secret', redirectUri: 'https://console.example.com/auth/github/callback' } }),
  })
  expect(first.status).toBe(200)

  const second = await api('/api/settings/oauth', ADMIN_TOKEN, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ github: { clientId: 'db-github-client-2', clientSecret: '', redirectUri: 'https://console.example.com/auth/github/callback' } }),
  })
  expect(second.status).toBe(200)
  expect((await storedSecrets()).github?.clientSecret).toBe('db-github-secret')

  const start = await api('/auth/github/start', ADMIN_TOKEN, { method: 'GET' })
  expect(start.status).toBe(302)
  expect(new URL(start.headers.get('location') ?? '').searchParams.get('client_id')).toBe('db-github-client-2')

  const revoked = await api('/api/settings/oauth?provider=github', ADMIN_TOKEN, { method: 'DELETE' })
  expect(revoked.status).toBe(200)
  const revokedBody = await revoked.json() as Record<string, unknown>
  expect(revokedBody.github).toMatchObject({ source: 'environment', clientId: 'runtime-github-client' })
})

test('无效 GitHub 回调地址拒绝保存，提交已废弃 Cloudflare OAuth 配置明确返回 400', async () => {
  const invalid = await api('/api/settings/oauth', ADMIN_TOKEN, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ github: { clientId: 'x', clientSecret: 'secret', redirectUri: 'not-a-url', allowlist: '' } }),
  })
  expect(invalid.status).toBe(400)

  const cloudflare = await api('/api/settings/oauth', ADMIN_TOKEN, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudflare: { clientId: 'old', clientSecret: 'old' } }),
  })
  expect(cloudflare.status).toBe(400)
  expect(await cloudflare.json()).toMatchObject({ error: expect.stringContaining('API Token') })

  const noSecret = await api('/api/settings/oauth', ADMIN_TOKEN, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ github: { clientId: 'x', clientSecret: '', redirectUri: 'https://console.example.com/auth/github/callback' } }),
  })
  expect(noSecret.status).toBe(200)
  expect((await storedSecrets()).github?.clientSecret).toBe('runtime-github-secret')
})
