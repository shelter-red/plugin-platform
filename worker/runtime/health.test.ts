import { SELF } from 'cloudflare:test'
import { expect, test } from 'vitest'
import { testEnv } from './helpers'

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
