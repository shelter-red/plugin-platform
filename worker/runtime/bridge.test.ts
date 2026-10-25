import { beforeEach, expect, test } from 'vitest'
import type { ControlFrame } from '../src/types'
import { decodeBody, openControl, publicRequest, reply, seedServer, sendFrame, testEnv, resetDatabase } from './helpers'

beforeEach(resetDatabase)

test('真实 Durable Object 转发 HTTP 方法、请求头、响应头与状态码', async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const pending = channel.next()
  const responsePromise = publicRequest(hostname, '/created?from=test', { method: 'POST', headers: { 'x-runtime-case': 'forwarded', 'content-type': 'application/json' }, body: '{"hello":"worker"}' })
  const frame = await pending
  expect(frame.type).toBe('request.open')
  expect(frame.payload?.method).toBe('POST')
  expect(frame.payload?.path).toBe('/created?from=test')
  expect((frame.payload?.headers as Record<string, string>)['x-runtime-case']).toBe('forwarded')
  expect(decodeBody(frame.payload)).toBe('{"hello":"worker"}')
  reply(socket, frame, 201, 'created by plugin', { 'x-plugin-version': '1.2.0' })
  const response = await responsePromise
  expect(response.status).toBe(201)
  expect(response.headers.get('x-plugin-version')).toBe('1.2.0')
  expect(await response.text()).toBe('created by plugin')
  await expect.poll(async () => {
    const row = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM request_logs WHERE hostname = ? AND status = 201').bind(hostname).first<{ count: number }>()
    return row?.count ?? 0
  }, { timeout: 3_000 }).toBe(1)
  socket.close(1000, 'test complete')
})

test('真实 Durable Object 转发 Cookie 与二进制请求/响应', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const requestBytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
  const pending = channel.next()
  const responsePromise = publicRequest(hostname, '/binary', {
    method: 'POST',
    headers: { cookie: 'session=abc; theme=dark', 'content-type': 'application/octet-stream' },
    body: requestBytes,
  })
  const frame = await pending
  expect(frame.type).toBe('request.open')
  expect((frame.payload?.headers as Record<string, string>).cookie).toBe('session=abc; theme=dark')
  expect(Uint8Array.from(decodeBody(frame.payload), (char) => char.charCodeAt(0))).toEqual(requestBytes)

  const responseBytes = new Uint8Array([255, 254, 0, 42])
  const requestId = frame.requestId
  sendFrame(socket, 'request.open', { status: 206, headers: { 'content-type': 'application/octet-stream', 'set-cookie': ['session=rotated; Path=/; HttpOnly; SameSite=Lax', 'theme=light; Path=/; SameSite=Lax'] } }, requestId)
  sendFrame(socket, 'request.chunk', { data: btoa(String.fromCharCode(...responseBytes)), encoding: 'base64' }, requestId)
  sendFrame(socket, 'request.close', {}, requestId)

  const response = await responsePromise
  expect(response.status).toBe(206)
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(response.headers.getSetCookie()).toEqual(['session=rotated; Path=/; HttpOnly; SameSite=Lax', 'theme=light; Path=/; SameSite=Lax'])
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(responseBytes)
  socket.close(1000, 'test complete')
})

test('真实 Durable Object 并发请求按 requestId 隔离并支持乱序响应', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const count = 16
  const responses = Array.from({ length: count }, (_, index) => publicRequest(hostname, `/echo?n=${index}`, { method: 'POST', body: `payload-${index}` }))
  const frames: ControlFrame[] = []
  for (let index = 0; index < count; index += 1) frames.push(await channel.next())
  expect(new Set(frames.map((frame) => frame.requestId)).size).toBe(count)
  for (const frame of [...frames].reverse()) {
    await new Promise((resolve) => setTimeout(resolve, 2))
    reply(socket, frame, 200, `${String(frame.payload?.method)} ${String(frame.payload?.path)} ${decodeBody(frame.payload)}`)
  }
  const settled = await Promise.all(responses)
  const bodies = await Promise.all(settled.map((response) => response.text()))
  for (let index = 0; index < count; index += 1) {
    expect(bodies[index]).toBe(`POST /echo?n=${index} payload-${index}`)
  }
  socket.close(1000, 'test complete')
})

test('真实 Durable Object 为公开 WebSocket 分配独立 connectionId', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket, channel } = await openControl()
  const openPublic = async (path: string) => {
    const response = await publicRequest(hostname, path, { headers: { Upgrade: 'websocket' } })
    expect(response.status).toBe(101)
    const webSocket = response.webSocket
    if (!webSocket) throw new Error('missing public websocket')
    webSocket.accept()
    const messages: string[] = []
    webSocket.addEventListener('message', (event) => { messages.push(String(event.data)) })
    return { webSocket, messages }
  }
  const first = await openPublic('/stream?client=first')
  const second = await openPublic('/stream?client=second')
  const opened: ControlFrame[] = [await channel.next(), await channel.next()]
  const byPath = new Map(opened.map((frame) => [String(frame.payload?.path), frame]))
  const firstFrame = byPath.get('/stream?client=first')
  const secondFrame = byPath.get('/stream?client=second')
  if (!firstFrame || !secondFrame) throw new Error('missing stream.open frames')
  const firstConnection = String(firstFrame.payload?.connectionId)
  const secondConnection = String(secondFrame.payload?.connectionId)
  expect(firstConnection).not.toBe(secondConnection)
  sendFrame(socket, 'stream.chunk', { connectionId: firstConnection, data: 'first-only', encoding: 'text' })
  sendFrame(socket, 'stream.chunk', { connectionId: secondConnection, data: 'second-only', encoding: 'text' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(first.messages).toEqual(['first-only'])
  expect(second.messages).toEqual(['second-only'])
  sendFrame(socket, 'stream.close', { connectionId: firstConnection, code: 1000, reason: 'done' })
  sendFrame(socket, 'stream.close', { connectionId: secondConnection, code: 1000, reason: 'done' })
  first.webSocket.close()
  second.webSocket.close()
  socket.close(1000, 'test complete')
})

test('控制连接断开后公开入口立即离线且不把运行态写入 D1', { timeout: 20_000 }, async () => {
  const hostname = await seedServer()
  const { socket } = await openControl()
  socket.close(1000, 'simulated network drop')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bridge = testEnv.PLUGIN_BRIDGE.get(testEnv.PLUGIN_BRIDGE.idFromName('server-runtime'))
    const response = await bridge.fetch(new Request('https://worker.invalid/status'))
    const status = await response.json() as { online: boolean }
    if (!status.online) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const response = await publicRequest(hostname, '/after-disconnect')
  expect(response.status).toBe(503)
  expect(await response.text()).toContain('插件暂时不可用')
  const state = await testEnv.DB.prepare('SELECT state FROM plugin_instances WHERE id = ?').bind('plugin-runtime').first<{ state: string }>()
  const domain = await testEnv.DB.prepare('SELECT status FROM domains WHERE id = ?').bind('domain-runtime').first<{ status: string }>()
  expect(state?.state).toBe('enabled')
  expect(domain?.status).toBe('online')
})

test('未启用的插件在真实 D1 路由解析后返回维护页', async () => {
  const hostname = await seedServer({ pluginState: 'disabled' })
  const response = await publicRequest(hostname, '/disabled')
  expect(response.status).toBe(503)
  expect(await response.text()).toContain('插件暂时不可用')
  const log = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM request_logs WHERE hostname = ?').bind(hostname).first<{ count: number }>()
  expect(log?.count).toBe(0)
})
