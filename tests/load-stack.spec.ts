import { expect, test } from '@playwright/test'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'
import { startRealServer } from './real-stack-server'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'real-stack-session-token'
const httpRequests = Number(process.env.PLUGMESH_LOAD_HTTP_REQUESTS ?? 300)
const httpConcurrency = Number(process.env.PLUGMESH_LOAD_HTTP_CONCURRENCY ?? 100)
const streamConnections = Number(process.env.PLUGMESH_LOAD_STREAMS ?? 40)
const websocketConnections = Number(process.env.PLUGMESH_LOAD_WEBSOCKETS ?? 40)
const rounds = Number(process.env.PLUGMESH_LOAD_ROUNDS ?? 3)

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

type Target = { hostname: string; host: string; port: number }

function makeTarget(base: string, hostname: string): Target {
  const url = new URL(base)
  return { hostname: url.hostname, host: hostname, port: Number(url.port || 80) }
}

function publicRequest(target: Target, options: { method?: string; accept?: string; path?: string } = {}) {
  return http.request({
    hostname: target.hostname,
    port: target.port,
    path: options.path ?? '/',
    method: options.method ?? 'GET',
    headers: { host: target.host, ...(options.accept ? { accept: options.accept } : {}) },
  })
}

function getPublic(target: Target) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = publicRequest(target)
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
    request.end()
  })
}

async function runPool(total: number, concurrency: number, task: (index: number) => Promise<void>) {
  let next = 0
  const failures: string[] = []
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const index = next++
      if (index >= total) return
      try {
        await task(index)
      } catch (error) {
        failures.push(`#${index}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }))
  if (failures.length > 0) throw new Error(`${failures.length} 个并发任务失败，示例：${failures.slice(0, 3).join(' | ')}`)
}

function percentile(samples: number[], ratio: number) {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

async function openStream(target: Target) {
  const request = publicRequest(target, { accept: 'text/event-stream' })
  const responsePromise = once(request, 'response') as Promise<[http.IncomingMessage]>
  request.end()
  const [response] = await responsePromise
  if (response.statusCode !== 200) throw new Error(`SSE 状态码 ${response.statusCode}`)
  const firstChunk = await Promise.race([
    once(response, 'data') as Promise<[Buffer]>,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE 首个数据块超时')), 10_000)),
  ])
  if (!firstChunk[0].toString('utf8').startsWith('data: ')) throw new Error(`SSE 数据块格式异常：${firstChunk[0].toString('utf8').slice(0, 40)}`)
  return { request, response }
}

function openEcho(target: Target) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://${target.hostname}:${target.port}/`, { headers: { host: target.host } })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket 连接超时')) }, 10_000)
    socket.once('error', (error) => { clearTimeout(timer); reject(error) })
    socket.once('open', () => { clearTimeout(timer); resolve(socket) })
  })
}

function echoOnce(socket: WebSocket, payload: string) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 回显超时')), 10_000)
    socket.once('message', (data) => { clearTimeout(timer); resolve(data.toString()) })
    socket.send(payload)
  })
}

test('公开入口在数百并发下的 HTTP、SSE 和 WebSocket 表现', async ({ request }) => {
  test.setTimeout(600_000)
  const cookie = `plugmesh_session=${sessionToken}`
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await request.fetch(path, { ...init, headers: { cookie, ...(init.headers ?? {}) } })
    if (!response.ok()) throw new Error(`${init.method ?? 'GET'} ${path} 失败：${response.status()} ${await response.text()}`)
    return response
  }

  const codeResponse = await api('/api/registration-codes', { method: 'POST' })
  const { code } = (await codeResponse.json()) as { code: string }
  const server = await startRealServer(baseURL!, code)
  try {
    await expect
      .poll(async () => {
        const body = (await (await api('/api/servers')).json()) as { results: Array<{ id: string; name: string; status: string }> }
        return body.results.find((item) => item.name === server.name)?.status
      }, { timeout: 60_000 })
      .toBe('online')

    const servers = (await (await api('/api/servers')).json()) as { results: Array<{ id: string; name: string }> }
    const serverId = servers.results.find((item) => item.name === server.name)!.id
    const plugins = (await (await api('/api/plugins')).json()) as { results: Array<{ id: string; plugin_id: string; server_id: string; state: string }> }
    const plugin = plugins.results.find((item) => item.server_id === serverId && item.plugin_id === 'sample.plugin')
    expect(plugin, 'sample.plugin 应已注册到新服务器').toBeTruthy()

    await api(`/api/plugins/${plugin.id}/load`, { method: 'POST' })
    await expect
      .poll(async () => {
        const body = (await (await api(`/api/plugins/${plugin.id}`)).json()) as { plugin: { state: string } }
        return body.plugin.state
      }, { timeout: 60_000 })
      .toBe('loaded')
    await api(`/api/plugins/${plugin.id}/enable`, { method: 'POST' })
    await expect
      .poll(async () => {
        const body = (await (await api(`/api/plugins/${plugin.id}`)).json()) as { plugin: { state: string } }
        return body.plugin.state
      }, { timeout: 60_000 })
      .toBe('enabled')

    const prefix = `load-${Date.now().toString(36)}`
    const domainResponse = await api('/api/domains', { method: 'POST', data: { pluginInstanceId: plugin.id, prefix } })
    const { hostname } = (await domainResponse.json()) as { hostname: string }
    const target = makeTarget(baseURL!, hostname)
    await expect.poll(async () => (await getPublic(target)).status, { timeout: 30_000 }).toBe(200)

    const usage = async () => (await (await api('/api/usage/local')).json()) as { activeConnections: number }
    expect((await usage()).activeConnections).toBe(0)

    const samples: number[] = []
    for (let round = 1; round <= rounds; round += 1) {
      const startedAt = Date.now()
      await runPool(httpRequests, httpConcurrency, async () => {
        const beganAt = Date.now()
        const response = await getPublic(target)
        samples.push(Date.now() - beganAt)
        if (response.status !== 200 || response.body !== 'ok') throw new Error(`HTTP ${response.status} ${response.body.slice(0, 40)}`)
      })
      console.log(`HTTP 第 ${round} 轮：${httpRequests} 个请求 / 并发 ${httpConcurrency}，用时 ${Date.now() - startedAt} ms`)
    }
    const httpOk = samples.length
    console.log(`HTTP 延迟 p50=${percentile(samples, 0.5)} ms p95=${percentile(samples, 0.95)} ms max=${Math.max(...samples)} ms（${httpOk} 次成功）`)

    // 示例插件的 SSE 处理器写一帧后立即结束，无法让连接驻留，因此这里只验证并发建立、首帧到达与连接回收。
    const streams = await Promise.all(Array.from({ length: streamConnections }, () => openStream(target)))
    for (const stream of streams) stream.response.destroy()
    await expect.poll(async () => (await usage()).activeConnections, { timeout: 30_000 }).toBe(0)
    console.log(`SSE：${streamConnections} 条并发流全部收到首帧`)

    const sockets = await Promise.all(Array.from({ length: websocketConnections }, () => openEcho(target)))
    for (const [index, socket] of sockets.entries()) expect(await echoOnce(socket, `load-${index}`)).toBe(`load-${index}`)
    await expect.poll(async () => (await usage()).activeConnections, { timeout: 20_000 }).toBeGreaterThanOrEqual(websocketConnections)
    for (const socket of sockets) socket.close()
    await expect.poll(async () => (await usage()).activeConnections, { timeout: 30_000 }).toBe(0)

    console.log(`WebSocket：${websocketConnections} 条连接同时驻留并逐条回显，关闭后活跃连接归零`)
  } finally {
    await server.stop()
  }
})
