import { beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { openControl, publicRequest, reply, resetDatabase, seedServer, testEnv } from './helpers'

beforeEach(resetDatabase)

test('公开请求只写访问日志用于统计，请求数不设上限也不会进入维护模式', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const settings = { ...defaultPlatformSettings, maintenance: false }
  await testEnv.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(settings), new Date().toISOString()).run()
  setPlatformSettingsCache(settings)

  for (let index = 0; index < 2; index += 1) {
    const pending = channel.next()
    const responsePromise = publicRequest(hostname, `/count/${index}`)
    reply(socket, await pending, 200, 'ok')
    expect((await responsePromise).status).toBe(200)
  }

  // 用量页复用每个公开请求已经生成的访问日志，不再重复更新全局计数行。
  const logs = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM request_logs WHERE hostname = ?').bind(hostname).first<{ count: number }>()
  expect(logs?.count).toBe(2)
  const usageColumns = await testEnv.DB.prepare('PRAGMA table_info(platform_usage)').all<{ name: string }>()
  expect(usageColumns.results.map((column) => column.name)).not.toContain('request_count')

  // 请求数不再触发维护模式，也不会发出维护通知。
  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(stored?.value_json ?? '{}').maintenance)).toBe(false)
  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'maintenance.email.%'").first<{ count: number }>()
  expect(audit?.count).toBe(0)

  socket.close(1000, 'test complete')
  setPlatformSettingsCache(defaultPlatformSettings)
})
