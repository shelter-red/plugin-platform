import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { hashToken, openControl, publicRequest, reply, resetDatabase, seedServer, sendFrame, testEnv } from './helpers'

const MEMBER_TOKEN = 'route-member-session'

const api = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, {
    ...init,
    headers: { cookie: `plugmesh_session=${MEMBER_TOKEN}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  })

async function seedSession(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-route-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now).run()
}

beforeEach(resetDatabase)

test('路由缓存命中期间沿用旧状态，插件停用后立即失效', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  await seedSession()
  const { socket, channel } = await openControl()

  const firstPending = channel.next()
  const first = publicRequest(hostname, '/')
  const firstFrame = await firstPending
  expect(firstFrame.type).toBe('request.open')
  reply(socket, firstFrame, 200, 'before')
  expect(await (await first).text()).toBe('before')

  await testEnv.DB.prepare('UPDATE domains SET status = ? WHERE hostname = ?').bind('offline', hostname).run()

  const cachedPending = channel.next()
  const cached = publicRequest(hostname, '/')
  const cachedFrame = await cachedPending
  expect(cachedFrame.type).toBe('request.open')
  reply(socket, cachedFrame, 200, 'cached')
  expect(await (await cached).text()).toBe('cached')

  const disablePending = channel.next()
  const disable = api('/api/plugins/plugin-runtime/disable', { method: 'POST' })
  const disableFrame = await disablePending
  expect(disableFrame.type).toBe('plugin.disable')
  sendFrame(socket, 'plugin.result', { ok: true, state: 'disabled' }, disableFrame.requestId)
  const disableResponse = await disable
  expect(disableResponse.status).toBe(202)
  expect(await disableResponse.json()).toMatchObject({ state: 'disabled', accepted: true })

  const blocked = await publicRequest(hostname, '/')
  expect(blocked.status).toBe(503)
  expect(await blocked.text()).toContain('插件暂时不可用')

  const plugin = await testEnv.DB.prepare('SELECT state, desired_state FROM plugin_instances WHERE id = ?').bind('plugin-runtime').first<{ state: string; desired_state: string }>()
  expect(plugin).toEqual({ state: 'disabled', desired_state: 'disabled' })
  const audit = await testEnv.DB.prepare("SELECT action FROM audit_log WHERE action = 'plugin.disable'").first<{ action: string }>()
  expect(audit?.action).toBe('plugin.disable')
  socket.close(1000, 'test complete')
})

test('插件状态与域名状态在同一事务内更新，域名写入失败时整体回滚', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  await seedSession()
  await testEnv.DB.prepare("CREATE TRIGGER fail_domain_update BEFORE UPDATE ON domains BEGIN SELECT RAISE(ABORT, 'forced domain update failure'); END").run()
  const { socket, channel } = await openControl()

  const disablePending = channel.next()
  const disable = api('/api/plugins/plugin-runtime/disable', { method: 'POST' })
  const disableFrame = await disablePending
  expect(disableFrame.type).toBe('plugin.disable')
  sendFrame(socket, 'plugin.result', { ok: true, state: 'disabled' }, disableFrame.requestId)
  const response = await disable.catch(() => null)
  expect(response?.status ?? 500).toBe(500)

  const plugin = await testEnv.DB.prepare('SELECT state, desired_state FROM plugin_instances WHERE id = ?').bind('plugin-runtime').first<{ state: string; desired_state: string }>()
  const domain = await testEnv.DB.prepare('SELECT status FROM domains WHERE hostname = ?').bind(hostname).first<{ status: string }>()
  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'plugin.disable'").first<{ count: number }>()
  expect(plugin).toEqual({ state: 'enabled', desired_state: 'enabled' })
  expect(domain?.status).toBe('online')
  expect(audit?.count).toBe(0)
  await testEnv.DB.prepare('DROP TRIGGER fail_domain_update').run()
  socket.close(1000, 'test complete')
})
