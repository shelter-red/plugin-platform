import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { hashToken, openControl, resetDatabase, seedServer, sendFrame, testEnv } from './helpers'

beforeEach(resetDatabase)

test('workerd 运行时加载真实迁移、D1 绑定与 Worker 入口', async () => {
  expect(testEnv.PLUGIN_DOMAIN_SUFFIX).toBe('plugins.example.com')
  const row = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'servers', 'plugin_instances', 'domains', 'request_logs')").first<{ count: number }>()
  expect(row?.count).toBe(5)
  const health = await SELF.fetch('https://console.example.com/api/health')
  expect(health.status).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true, protocolVersion: 1 })
  const missing = await SELF.fetch('https://unknown.plugins.example.com/')
  expect(missing.status).toBe(404)
})

test('插件健康检查接受桥接层 accepted/status 返回形状', { timeout: 20_000 }, async () => {
  await seedServer({ domainStatus: 'offline' })
  const token = 'runtime-health-session'
  const now = new Date().toISOString()
  await testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), 'user-runtime', await hashToken(token), new Date(Date.now() + 60 * 60 * 1000).toISOString(), now).run()
  const { socket, channel } = await openControl()
  const responsePromise = SELF.fetch('https://console.example.com/api/plugins/plugin-runtime/health', { method: 'POST', headers: { Cookie: `plugmesh_session=${token}` } })
  let healthFrame = await channel.next()
  while (healthFrame.type !== 'plugin.health') healthFrame = await channel.next()
  expect(healthFrame.pluginId).toBe('sample.runtime')
  sendFrame(socket, 'plugin.result', { ok: true, status: 200, bodySize: 2 }, healthFrame.requestId)
  const response = await responsePromise
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id: 'plugin-runtime', ok: true, status: 200, bodySize: 2 })
  const domain = await testEnv.DB.prepare('SELECT status FROM domains WHERE id = ?').bind('domain-runtime').first<{ status: string }>()
  expect(domain?.status).toBe('online')
  const audit = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE action = ?').bind('plugin.health').first<{ count: number }>()
  expect(audit?.count).toBe(1)
  socket.close(1000, 'test complete')
})
