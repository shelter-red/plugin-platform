import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { addWorkspaceMember, hashToken, openControl, publicRequest, reply, resetDatabase, seedServer, sendFrame, testEnv } from './helpers'
import { CLOUDFLARE_STUB_EMAIL, CLOUDFLARE_STUB_GLOBAL_API_KEY } from './outbound-stub'

const ADMIN_TOKEN = 'admin-session-token'
const MEMBER_TOKEN = 'member-session-token'
const VIEWER_TOKEN = 'viewer-session-token'

const authHeaders = (token: string, json = false): Record<string, string> => ({
  cookie: `plugmesh_session=${token}`,
  ...(json ? { 'content-type': 'application/json' } : {}),
})

const api = (path: string, token: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, { ...init, headers: { ...authHeaders(token, Boolean(init.body)), ...(init.headers as Record<string, string> | undefined) } })

async function seedAdmin(token = ADMIN_TOKEN): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-admin', 'gh-admin', 'admin@example.com', 'Admin', 'super_admin', now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-admin', 'user-admin', await hashToken(token), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

async function seedMemberSession(token = MEMBER_TOKEN): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-member', 'user-runtime', await hashToken(token), new Date(Date.now() + 3_600_000).toISOString(), now).run()
}

// 工作区 viewer 只读：用于验证成员越权被拒，owner（user-runtime）仍可写。
async function seedViewerSession(token = VIEWER_TOKEN): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-viewer', 'gh-viewer', 'viewer@example.com', 'Viewer', 'member', now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-viewer', 'user-viewer', await hashToken(token), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
  await addWorkspaceMember('user-viewer', 'viewer')
}

beforeEach(async () => {
  await resetDatabase()
  setPlatformSettingsCache(defaultPlatformSettings)
})

test('邀请接口已移除且工作区 viewer 不能执行写操作', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedAdmin()
  await seedMemberSession()
  await seedViewerSession()

  const anonymous = await SELF.fetch('https://console.example.com/api/invites')
  expect(anonymous.status).toBe(401)

  const forbidden = await api('/api/registration-codes', VIEWER_TOKEN, { method: 'POST' })
  expect(forbidden.status).toBe(403)
  expect((await forbidden.json() as { error: string }).error).toBe('Workspace is read-only for viewers')

  expect((await api('/api/invites', ADMIN_TOKEN)).status).toBe(404)
  expect((await api('/api/invites', ADMIN_TOKEN, { method: 'POST', body: '{}' })).status).toBe(404)
  expect((await api('/api/invites/obsolete', ADMIN_TOKEN, { method: 'DELETE' })).status).toBe(404)
})

test('管理 API 生成的注册码只能兑换一次并绑定到当前用户', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedMemberSession()

  const created = await api('/api/registration-codes', MEMBER_TOKEN, { method: 'POST' })
  expect(created.status).toBe(201)
  const { code, expiresAt } = await created.json() as { code: string; expiresAt: string }
  expect(code.length).toBeGreaterThan(16)
  expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000)

  const register = (value: string) => SELF.fetch('https://console.example.com/control/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: value, name: 'Bound server' }),
  })
  const first = await register(code)
  expect(first.status).toBe(201)
  const binding = await first.json() as { serverId: string; accessToken: string }
  expect(binding.serverId).toBeTruthy()
  expect(binding.accessToken.length).toBeGreaterThan(16)

  expect((await register(code)).status).toBe(401)

  const server = await testEnv.DB.prepare('SELECT user_id, name, token_hash FROM servers WHERE id = ?').bind(binding.serverId).first<{ user_id: string; name: string; token_hash: string }>()
  expect(server?.user_id).toBe('user-runtime')
  expect(server?.name).toBe('Bound server')
  expect(server?.token_hash).toBe(await hashToken(binding.accessToken))
})

test('未知插件动作直接返回 404，不进入 Durable Object 命令队列', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedMemberSession()
  const { socket } = await openControl()

  const response = await api('/api/plugins/plugin-runtime/explode', MEMBER_TOKEN, {
    method: 'POST',
    signal: AbortSignal.timeout(2_000),
  })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })

  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'plugin.%'").first<{ count: number }>()
  expect(audit?.count).toBe(0)
  socket.close(1000, 'test complete')
})

test('域名分配校验前缀、插件状态、服务器在线与健康检查', { timeout: 30_000 }, async () => {
  await seedServer()
  await seedAdmin()
  await seedMemberSession()
  const token = await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_GLOBAL_API_KEY }) })
  expect(token.status).toBe(200)
  const configured = await api('/api/settings/platform', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ pluginDomainSuffix: 'plugins.example.net' }) })
  expect(configured.status).toBe(200)
  await testEnv.DB.prepare('DELETE FROM domains WHERE id = ?').bind('domain-runtime').run()

  const assign = (prefix: string, pluginInstanceId = 'plugin-runtime') => api('/api/domains', MEMBER_TOKEN, { method: 'POST', body: JSON.stringify({ prefix, pluginInstanceId }) })

  expect((await assign('Bad_Prefix')).status).toBe(400)
  expect((await assign('api')).status).toBe(400)
  expect((await assign('ok-prefix', 'missing-plugin')).status).toBe(404)
  const offline = await assign('ok-prefix')
  expect(offline.status).toBe(409)
  expect((await offline.json() as { error: string }).error).toBe('Plugin server is offline')

  const { socket, channel } = await openControl()

  const failedHealth = assign('ok-prefix')
  const healthFrame = await channel.next()
  expect(healthFrame.type).toBe('plugin.health')
  sendFrame(socket, 'plugin.result', { ok: true, status: 503 }, healthFrame.requestId)
  const failed = await failedHealth
  expect(failed.status).toBe(409)
  expect((await failed.json() as { error: string }).error).toBe('Plugin health check failed')

  const healthy = assign('ok-prefix')
  const healthyFrame = await channel.next()
  sendFrame(socket, 'plugin.result', { ok: true, status: 200 }, healthyFrame.requestId)
  const assigned = await healthy
  expect(assigned.status).toBe(201)
  expect(await assigned.json()).toMatchObject({ hostname: 'ok-prefix.plugins.example.net', status: 'online' })

  const publicResponsePromise = publicRequest('ok-prefix.plugins.example.net', '/dynamic-suffix')
  const publicFrame = await channel.next()
  expect(publicFrame.type).toBe('request.open')
  expect(publicFrame.payload?.path).toBe('/dynamic-suffix')
  reply(socket, publicFrame, 200, 'dynamic suffix ok')
  const publicResponse = await publicResponsePromise
  expect(publicResponse.status).toBe(200)
  expect(await publicResponse.text()).toBe('dynamic suffix ok')

  const duplicate = assign('ok-prefix')
  const duplicateFrame = await channel.next()
  sendFrame(socket, 'plugin.result', { ok: true, status: 200 }, duplicateFrame.requestId)
  expect((await duplicate).status).toBe(409)

  const audit = await testEnv.DB.prepare("SELECT action FROM audit_log WHERE action IN ('plugin.health', 'domain.assigned') ORDER BY rowid").all<{ action: string }>()
  expect(audit.results.map((row) => row.action)).toEqual(['plugin.health', 'domain.assigned', 'plugin.health'])

  socket.close(1000, 'test complete')
})

test('管理 API 保存配额并让维护模式阻止注册码与域名分配', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedAdmin()
  await seedMemberSession()
  const token = await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_GLOBAL_API_KEY }) })
  expect(token.status).toBe(200)

  const forbidden = await api('/api/settings/platform', MEMBER_TOKEN, { method: 'PUT', body: JSON.stringify({ maintenance: true }) })
  expect(forbidden.status).toBe(403)

  const updated = await api('/api/settings/platform', ADMIN_TOKEN, {
    method: 'PUT',
    body: JSON.stringify({ pluginDomainSuffix: 'Plugins.Example.NET', quotas: { r2Objects: 250, activeConnections: -5 } }),
  })
  expect(updated.status).toBe(200)
  const settings = await updated.json() as typeof defaultPlatformSettings
  expect(settings.maintenance).toBe(false)
  expect(settings.pluginDomainSuffix).toBe('.plugins.example.net')
  expect(settings.quotas.r2Objects).toBe(250)
  expect(settings.quotas.activeConnections).toBe(defaultPlatformSettings.quotas.activeConnections)

  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(JSON.parse(stored?.value_json ?? '{}').pluginDomainSuffix).toBe('.plugins.example.net')
  expect(JSON.parse(stored?.value_json ?? '{}').quotas.r2Objects).toBe(250)

  const invalidSuffix = await api('/api/settings/platform', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ pluginDomainSuffix: 'not a domain' }) })
  expect(invalidSuffix.status).toBe(400)

  const maintenance = await api('/api/settings/platform', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ maintenance: true }) })
  expect((await maintenance.json() as typeof defaultPlatformSettings).maintenance).toBe(true)

  const code = await api('/api/registration-codes', MEMBER_TOKEN, { method: 'POST' })
  expect(code.status).toBe(503)
  const domain = await api('/api/domains', MEMBER_TOKEN, { method: 'POST', body: JSON.stringify({ prefix: 'blocked', pluginInstanceId: 'plugin-runtime' }) })
  expect(domain.status).toBe(503)

  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'platform.settings.updated'").first<{ count: number }>()
  expect(audit?.count).toBe(2)
})
