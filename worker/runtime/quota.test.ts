import { beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { openControl, publicRequest, reply, resetDatabase, seedServer, testEnv } from './helpers'

beforeEach(resetDatabase)

test('真实 D1 在公开请求配额耗尽后进入全局维护模式', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const settings = { maintenance: false, quotas: { ...defaultPlatformSettings.quotas, requests: 1 } }
  await testEnv.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(settings), new Date().toISOString()).run()
  setPlatformSettingsCache(settings)

  const pending = channel.next()
  const firstPromise = publicRequest(hostname, '/')
  reply(socket, await pending, 200, 'ok')
  const first = await firstPromise
  expect(first.status).toBe(200)
  const usage = await testEnv.DB.prepare('SELECT request_count FROM platform_usage WHERE key = ?').bind('global').first<{ request_count: number }>()
  expect(usage?.request_count).toBe(1)

  const second = await publicRequest(hostname, '/')
  expect(second.status).toBe(503)
  expect(await second.text()).toContain('平台维护中')

  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(stored?.value_json ?? '{}').maintenance)).toBe(true)
  const audit = await testEnv.DB.prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'maintenance.email.%'").all<{ action: string; detail_json: string }>()
  expect(audit.results.map((row) => row.action)).toContain('maintenance.email.skipped')
  expect(JSON.parse(audit.results[0]?.detail_json ?? '{}').reason).toBe('request quota reached')

  const third = await publicRequest(hostname, '/')
  expect(third.status).toBe(503)
  expect(await third.text()).toContain('平台维护中')

  socket.close(1000, 'test complete')
  setPlatformSettingsCache(defaultPlatformSettings)
})
