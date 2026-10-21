import { beforeEach, expect, test } from 'vitest'
import { openControl, publicRequest, seedServer, sendFrame, testEnv, resetDatabase } from './helpers'

beforeEach(resetDatabase)

const bytesToBase64 = (bytes: Uint8Array): string => {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

test('真实 Durable Object 以 SSE 流式返回插件数据并在结束后释放活跃连接', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const responsePromise = publicRequest(hostname, '/events', { headers: { accept: 'text/event-stream' } })
  const frame = await channel.next()
  expect(frame.type).toBe('stream.open')
  expect(frame.payload?.path).toBe('/events')
  sendFrame(socket, 'stream.chunk', { data: 'data: first\n\n' }, frame.requestId)
  const response = await responsePromise
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  sendFrame(socket, 'stream.chunk', { data: 'data: second\n\n' }, frame.requestId)
  sendFrame(socket, 'request.close', {}, frame.requestId)
  expect(await response.text()).toBe('data: first\n\ndata: second\n\n')
  await expect.poll(async () => {
    const row = await testEnv.DB.prepare('SELECT active_connections FROM platform_usage WHERE key = ?').bind('global').first<{ active_connections: number }>()
    return row?.active_connections ?? 0
  }, { timeout: 3_000 }).toBe(0)
  socket.close(1000, 'test complete')
})

async function largeFileRoundTrip(declaredLength: boolean): Promise<void> {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const chunk = new Uint8Array(32 * 1024).fill(7)
  const total = chunk.byteLength * 33
  const responsePromise = publicRequest(hostname, '/large.bin', { headers: { 'x-plugmesh-file-stream': 'true' } })
  const frame = await channel.next()
  expect(frame.type).toBe('request.open')
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream' }
  if (declaredLength) headers['content-length'] = String(total)
  sendFrame(socket, 'request.open', { status: 200, fileStream: true, headers }, frame.requestId)
  for (let index = 0; index < 33; index += 1) sendFrame(socket, 'request.chunk', { data: bytesToBase64(chunk), encoding: 'base64' }, frame.requestId)
  sendFrame(socket, 'request.close', { status: 200 }, frame.requestId)
  const response = await responsePromise
  expect(response.status).toBe(200)
  const body = new Uint8Array(await response.arrayBuffer())
  expect(body.byteLength).toBe(total)
  expect(body[0]).toBe(7)
  expect(body[total - 1]).toBe(7)
  await expect.poll(async () => {
    const objects = await testEnv.BLOB_BUCKET.list()
    return objects.objects.length
  }, { timeout: 3_000 }).toBe(0)
  await expect.poll(async () => {
    const row = await testEnv.DB.prepare('SELECT r2_bytes, r2_objects FROM platform_usage WHERE key = ?').bind('global').first<{ r2_bytes: number; r2_objects: number }>()
    return `${row?.r2_bytes ?? 0}/${row?.r2_objects ?? 0}`
  }, { timeout: 3_000 }).toBe('0/0')
  const tempObjects = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM temp_objects').first<{ count: number }>()
  expect(tempObjects?.count).toBe(0)
  socket.close(1000, 'test complete')
}

test('真实 R2 在声明 content-length 时按定长流中转大文件并清理对象', { timeout: 30_000 }, () => largeFileRoundTrip(true))

test('真实 R2 在缺少 content-length 时回退为关闭后一次上传并清理对象', { timeout: 30_000 }, () => largeFileRoundTrip(false))

test('超过 32 KiB 的公开请求体在真实 Worker 中被拒绝', async () => {
  const hostname = await seedServer()
  const { socket } = await openControl()
  const response = await publicRequest(hostname, '/too-large', { method: 'POST', body: 'x'.repeat(33 * 1024) })
  expect(response.status).toBe(413)
  expect(await response.text()).toBe('Plugin request body is too large')
  await expect.poll(async () => {
    const row = await testEnv.DB.prepare('SELECT status FROM request_logs WHERE hostname = ? ORDER BY created_at DESC LIMIT 1').bind(hostname).first<{ status: number }>()
    return row?.status ?? 0
  }, { timeout: 3_000 }).toBe(413)
  socket.close(1000, 'test complete')
})
