import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { hashToken, openControl, resetDatabase, seedServer, testEnv } from './helpers'
import { smtpSinkSettings } from './smtp-sink.config'

const ADMIN_TOKEN = 'smtp-admin-session'
const MEMBER_TOKEN = 'smtp-member-session'
const PASSWORD = 'smtp-secret-password'

const api = (path: string, token: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, {
    ...init,
    headers: {
      cookie: `plugmesh_session=${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })

const settings = {
  host: '127.0.0.1',
  port: 1,
  secure: false,
  username: 'mailer@example.com',
  password: PASSWORD,
  authType: 'plain',
  from: 'mailer@example.com',
  fromName: 'Plugmesh',
}

async function seedAccounts(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-smtp-admin', 'gh-smtp-admin', 'admin@example.com', 'SMTP Admin', 'super_admin', now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-smtp-admin', 'user-smtp-admin', await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-smtp-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

afterEach(() => setPlatformSettingsCache(defaultPlatformSettings))

let hostname = ''

beforeEach(async () => {
  await resetDatabase()
  hostname = await seedServer()
  await seedAccounts()
})

test('SMTP 设置加密落库且接口不回显密码', { timeout: 20_000 }, async () => {
  const saved = await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(settings) })
  expect(saved.status).toBe(200)
  const savedBody = await saved.json() as Record<string, unknown>
  expect(savedBody.configured).toBe(true)
  expect(savedBody.host).toBe('127.0.0.1')
  expect(savedBody).not.toHaveProperty('password')

  const stored = await testEnv.DB.prepare('SELECT ciphertext, iv FROM smtp_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  expect(stored?.ciphertext).toBeTruthy()
  expect(stored?.ciphertext).not.toContain(PASSWORD)
  expect(stored?.ciphertext).not.toContain('mailer@example.com')

  const read = await api('/api/settings/smtp', ADMIN_TOKEN)
  expect(read.status).toBe(200)
  const readBody = await read.json() as Record<string, unknown>
  expect(readBody.configured).toBe(true)
  expect(readBody.username).toBe('mailer@example.com')
  expect(readBody).not.toHaveProperty('password')

  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'smtp.%' ORDER BY rowid").all<{ action: string; detail_json: string }>()
  expect(audit.results.map((row) => row.action)).toEqual(['smtp.settings.updated'])
  expect(audit.results[0]!.detail_json).not.toContain(PASSWORD)

  const invalid = await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ ...settings, port: 25 }) })
  expect(invalid.status).toBe(400)
  const forbidden = await api('/api/settings/smtp', MEMBER_TOKEN, { method: 'PUT', body: JSON.stringify(settings) })
  expect(forbidden.status).toBe(403)

  const revoked = await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'DELETE' })
  expect(revoked.status).toBe(200)
  expect((await revoked.json() as { configured: boolean }).configured).toBe(false)
  const remaining = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM smtp_settings').first<{ count: number }>()
  expect(remaining?.count).toBe(0)
})

test('SMTP 测试发送在不可达服务器上重试三次并记录脱敏审计', { timeout: 30_000 }, async () => {
  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(settings) })
  const unconfiguredRecipient = await api('/api/settings/smtp/test', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ to: 'not-an-email' }) })
  expect(unconfiguredRecipient.status).toBe(400)
  const failed = await api('/api/settings/smtp/test', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ to: 'admin@example.com' }) })
  expect(failed.status).toBe(502)
  const failedBody = await failed.json() as { attempts: number }
  expect(failedBody.attempts).toBe(3)

  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action = 'smtp.test.failed'").all<{ action: string; detail_json: string }>()
  expect(audit.results).toHaveLength(1)
  const detail = JSON.parse(audit.results[0]!.detail_json) as { attempts: number; error: string }
  expect(detail.attempts).toBe(3)
  expect(detail.error).not.toContain(PASSWORD)

  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'DELETE' })
  const notConfigured = await api('/api/settings/smtp/test', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ to: 'admin@example.com' }) })
  expect(notConfigured.status).toBe(409)
})

test('配额触发维护模式时向管理员发送通知并记录失败重试', { timeout: 30_000 }, async () => {
  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(settings) })
  const { socket } = await openControl()
  const platform = { maintenance: false, quotas: { ...defaultPlatformSettings.quotas, requests: 0 } }
  await testEnv.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(platform), new Date().toISOString()).run()
  setPlatformSettingsCache(platform)

  const response = await SELF.fetch(`https://${hostname}/`)
  expect(response.status).toBe(503)

  await expect.poll(async () => {
    const row = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'maintenance.email.%'").first<{ count: number }>()
    return row?.count ?? 0
  }, { timeout: 10_000 }).toBe(1)
  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'maintenance.email.%'").first<{ action: string; detail_json: string }>()
  expect(audit?.action).toBe('maintenance.email.failed')
  const detail = JSON.parse(audit?.detail_json ?? '{}') as { reason: string; attempts: number }
  expect(detail.reason).toBe('request quota reached')
  expect(detail.attempts).toBe(3)
  expect(audit?.detail_json).not.toContain(PASSWORD)
  socket.close(1000, 'test complete')
  setPlatformSettingsCache(defaultPlatformSettings)
})

test('SMTP 不可达时邀请仍然创建并记录邮件失败审计', { timeout: 30_000 }, async () => {
  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(settings) })
  const created = await api('/api/invites', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ email: 'invitee@example.com' }) })
  expect(created.status).toBe(201)
  const body = await created.json() as { id: string; inviteUrl: string; emailSent: boolean | null }
  expect(body.emailSent).toBe(false)
  expect(body.inviteUrl).toContain('/auth/github/start?invite=')

  const invite = await testEnv.DB.prepare('SELECT status, email FROM invites WHERE id = ?').bind(body.id).first<{ status: string; email: string }>()
  expect(invite?.status).toBe('pending')
  expect(invite?.email).toBe('invitee@example.com')
  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action IN ('invite.email.failed', 'invite.created') ORDER BY rowid").all<{ action: string; detail_json: string }>()
  expect(audit.results.map((row) => row.action)).toEqual(['invite.email.failed', 'invite.created'])
  const failed = JSON.parse(audit.results[0]!.detail_json) as { attempts: number; to: string }
  expect(failed.attempts).toBe(3)
  expect(failed.to).toBe('invitee@example.com')
  expect(audit.results.some((row) => row.detail_json.includes(PASSWORD))).toBe(false)
})

test('SMTP 测试发送经真实 SMTP 会话投递', { timeout: 20_000 }, async () => {
  expect((await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(smtpSinkSettings) })).status).toBe(200)
  const sent = await api('/api/settings/smtp/test', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ to: 'ops@example.com' }) })
  expect(sent.status).toBe(200)
  expect(await sent.json()).toEqual({ sent: true, attempts: 1 })

  const audit = await testEnv.DB.prepare("SELECT detail_json FROM audit_log WHERE action = 'smtp.test.sent'").all<{ detail_json: string }>()
  expect(audit.results).toHaveLength(1)
  expect(JSON.parse(audit.results[0]!.detail_json)).toEqual({ to: 'ops@example.com', attempts: 1 })
})

test('SMTP 凭据被服务器拒绝时返回 502 且不泄漏密码', { timeout: 20_000 }, async () => {
  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ ...smtpSinkSettings, password: 'wrong-sink-password' }) })
  const failed = await api('/api/settings/smtp/test', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ to: 'ops@example.com' }) })
  expect(failed.status).toBe(502)
  expect((await failed.json() as { attempts: number }).attempts).toBe(3)
  const audit = await testEnv.DB.prepare("SELECT detail_json FROM audit_log WHERE action LIKE 'smtp.test.%'").all<{ detail_json: string }>()
  expect(audit.results).toHaveLength(1)
  expect(audit.results[0]!.detail_json).not.toContain('wrong-sink-password')
})

test('邀请邮件经真实 SMTP 会话投递', { timeout: 20_000 }, async () => {
  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(smtpSinkSettings) })
  const created = await api('/api/invites', ADMIN_TOKEN, { method: 'POST', body: JSON.stringify({ email: 'invitee@example.com' }) })
  expect(created.status).toBe(201)
  const body = await created.json() as { emailSent: boolean | null }
  expect(body.emailSent).toBe(true)
})

test('维护模式通知经真实 SMTP 会话投递', { timeout: 30_000 }, async () => {
  await api('/api/settings/smtp', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify(smtpSinkSettings) })
  const { socket } = await openControl()
  const platform = { maintenance: false, quotas: { ...defaultPlatformSettings.quotas, requests: 0 } }
  await testEnv.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(platform), new Date().toISOString()).run()
  setPlatformSettingsCache(platform)

  expect((await SELF.fetch(`https://${hostname}/`)).status).toBe(503)

  await expect.poll(async () => {
    const row = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'maintenance.email.%'").first<{ count: number }>()
    return row?.count ?? 0
  }, { timeout: 10_000 }).toBe(1)
  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'maintenance.email.%'").first<{ action: string; detail_json: string }>()
  expect(audit?.action).toBe('maintenance.email.sent')
  expect(JSON.parse(audit?.detail_json ?? '{}')).toMatchObject({ reason: 'request quota reached' })
  socket.close(1000, 'test complete')
  setPlatformSettingsCache(defaultPlatformSettings)
})
