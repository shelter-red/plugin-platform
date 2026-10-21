import { afterEach, beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { openControl, publicRequest, reply, resetDatabase, seedServer, sendFrame, testEnv } from './helpers'

beforeEach(resetDatabase)
afterEach(() => setPlatformSettingsCache(defaultPlatformSettings))

async function storeSettings(quotas: Partial<typeof defaultPlatformSettings.quotas>): Promise<void> {
  const settings = { maintenance: false, quotas: { ...defaultPlatformSettings.quotas, ...quotas } }
  await testEnv.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(settings), new Date().toISOString()).run()
  setPlatformSettingsCache(settings)
}

async function activeConnections(): Promise<number> {
  const row = await testEnv.DB.prepare('SELECT active_connections FROM platform_usage WHERE key = ?').bind('global').first<{ active_connections: number }>()
  return row?.active_connections ?? 0
}

async function openPublicSocket(hostname: string, path: string): Promise<Response> {
  return publicRequest(hostname, path, { headers: { Upgrade: 'websocket' } })
}

const chunk = new Uint8Array(32 * 1024).fill(9)
let encodedChunk = ''
for (const byte of chunk) encodedChunk += String.fromCharCode(byte)
encodedChunk = btoa(encodedChunk)

test('真实 Durable Object 处理 64 个并发公开请求并按乱序响应隔离', { timeout: 60_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const count = 64
  const responses = Array.from({ length: count }, (_, index) => publicRequest(hostname, `/load?n=${index}`, { method: 'POST', body: `payload-${index}` }))
  const frames = []
  for (let index = 0; index < count; index += 1) frames.push(await channel.next())
  expect(new Set(frames.map((frame) => frame.requestId)).size).toBe(count)
  const shuffled = [...frames].sort(() => Math.random() - 0.5)
  for (const frame of shuffled) {
    const path = String(frame.payload?.path)
    reply(socket, frame, 200, `reply ${path}`)
  }
  const bodies = await Promise.all((await Promise.all(responses)).map((response) => response.text()))
  for (let index = 0; index < count; index += 1) expect(bodies[index]).toBe(`reply /load?n=${index}`)
  expect(await activeConnections()).toBe(0)
  socket.close(1000, 'test complete')
})

test('活跃连接配额耗尽时拒绝新连接，关闭后释放额度', { timeout: 30_000 }, async () => {
  const hostname = await seedServer()
  await storeSettings({ activeConnections: 2 })
  const { socket } = await openControl()

  const first = await openPublicSocket(hostname, '/stream?client=first')
  const second = await openPublicSocket(hostname, '/stream?client=second')
  expect(first.status).toBe(101)
  expect(second.status).toBe(101)
  first.webSocket?.accept()
  second.webSocket?.accept()
  expect(await activeConnections()).toBe(2)

  const rejected = await openPublicSocket(hostname, '/stream?client=third')
  expect(rejected.status).toBe(503)
  expect(await rejected.text()).toBe('Platform quota reached')
  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(stored?.value_json ?? '{}').maintenance)).toBe(true)

  first.webSocket?.close()
  await expect.poll(activeConnections, { timeout: 3_000 }).toBe(1)

  await testEnv.DB.prepare("UPDATE platform_settings SET value_json = json_set(value_json, '$.maintenance', 0), updated_at = ? WHERE key = ?").bind(new Date().toISOString(), 'platform').run()
  setPlatformSettingsCache({ maintenance: false, quotas: { ...defaultPlatformSettings.quotas, activeConnections: 2 } })
  const reconnected = await openPublicSocket(hostname, '/stream?client=fourth')
  expect(reconnected.status).toBe(101)
  reconnected.webSocket?.accept()
  expect(await activeConnections()).toBe(2)

  reconnected.webSocket?.close()
  second.webSocket?.close()
  await expect.poll(activeConnections, { timeout: 3_000 }).toBe(0)
  socket.close(1000, 'test complete')
})

test('插件响应超过 16 MiB 时拒绝并释放缓冲数据', { timeout: 120_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const responsePromise = publicRequest(hostname, '/oversized')
  const frame = await channel.next()
  expect(frame.type).toBe('request.open')
  for (let index = 0; index < 513; index += 1) sendFrame(socket, 'request.chunk', { data: encodedChunk, encoding: 'base64' }, frame.requestId)
  const response = await responsePromise
  expect(response.status).toBe(502)
  expect(await response.text()).toBe('Plugin response is too large')
  await expect.poll(activeConnections, { timeout: 5_000 }).toBe(0)
  const objects = await testEnv.BLOB_BUCKET.list()
  expect(objects.objects.length).toBe(0)
  const tempObjects = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM temp_objects').first<{ count: number }>()
  expect(tempObjects?.count).toBe(0)
  socket.close(1000, 'test complete')
})

test('大文件中转配额耗尽时返回维护响应并清理 R2 对象', { timeout: 30_000 }, async () => {
  const hostname = await seedServer()
  await storeSettings({ r2Objects: 0 })
  const { socket, channel } = await openControl()
  const responsePromise = publicRequest(hostname, '/large.bin', { headers: { 'x-plugmesh-file-stream': 'true' } })
  const frame = await channel.next()
  expect(frame.type).toBe('request.open')
  sendFrame(socket, 'request.open', { status: 200, fileStream: true, headers: { 'content-type': 'application/octet-stream' } }, frame.requestId)
  for (let index = 0; index < 33; index += 1) sendFrame(socket, 'request.chunk', { data: encodedChunk, encoding: 'base64' }, frame.requestId)
  sendFrame(socket, 'request.close', { status: 200 }, frame.requestId)
  const response = await responsePromise
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('Platform quota reached')
  const objects = await testEnv.BLOB_BUCKET.list()
  expect(objects.objects.length).toBe(0)
  const usage = await testEnv.DB.prepare('SELECT r2_bytes, r2_objects FROM platform_usage WHERE key = ?').bind('global').first<{ r2_bytes: number; r2_objects: number }>()
  expect(`${usage?.r2_bytes ?? 0}/${usage?.r2_objects ?? 0}`).toBe('0/0')
  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(stored?.value_json ?? '{}').maintenance)).toBe(true)
  socket.close(1000, 'test complete')
})
