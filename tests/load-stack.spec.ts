import { expect, test } from '@playwright/test'
import { echoOnce, getPublic, openEcho, openStream } from './public-client'
import { preparePublicPlugin } from './real-stack-plugin'
import { createStackApi } from './stack-api'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'real-stack-session-token'
const httpRequests = Number(process.env.PLUGMESH_LOAD_HTTP_REQUESTS ?? 300)
const httpConcurrency = Number(process.env.PLUGMESH_LOAD_HTTP_CONCURRENCY ?? 100)
const streamConnections = Number(process.env.PLUGMESH_LOAD_STREAMS ?? 40)
const websocketConnections = Number(process.env.PLUGMESH_LOAD_WEBSOCKETS ?? 40)
const rounds = Number(process.env.PLUGMESH_LOAD_ROUNDS ?? 3)

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

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

test('公开入口在数百并发下的 HTTP、SSE 和 WebSocket 表现', async ({ request }) => {
  test.setTimeout(600_000)
  const { api } = createStackApi(request, sessionToken)

  const { server, target } = await preparePublicPlugin(baseURL!, api)
  try {
    const usage = async () => (await (await api('/api/usage/local')).json()) as { activeConnections: number; requestCount: number }
    expect((await usage()).activeConnections).toBe(0)
    const requestsBefore = (await usage()).requestCount

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

    const reserved = httpRequests * rounds + streamConnections + websocketConnections
    const requestsAfter = (await usage()).requestCount
    expect(requestsAfter - requestsBefore, '平台请求计数应覆盖本轮压测的每次公开请求与长连接升级').toBeGreaterThanOrEqual(reserved)
    console.log(`用量计数：本轮新增 ${requestsAfter - requestsBefore} 次请求记录（预期至少 ${reserved}）`)
  } finally {
    await server.stop()
  }
})
