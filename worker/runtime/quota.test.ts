import { beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { openControl, publicRequest, reply, resetDatabase, seedServer, testEnv } from './helpers'

beforeEach(resetDatabase)

test('公开请求只累计平台计数，请求数不设上限也不会进入维护模式', { timeout: 20_000 }, async () => {
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

  // 计数仍要准确，供用量页展示。
  const usage = await testEnv.DB.prepare('SELECT request_count FROM platform_usage WHERE key = ?').bind('global').first<{ request_count: number }>()
  expect(usage?.request_count).toBe(2)

  // 请求数不再触发维护模式，也不会发出维护通知。
  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(stored?.value_json ?? '{}').maintenance)).toBe(false)
  const audit = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'maintenance.email.%'").first<{ count: number }>()
  expect(audit?.count).toBe(0)

  socket.close(1000, 'test complete')
  setPlatformSettingsCache(defaultPlatformSettings)
})
