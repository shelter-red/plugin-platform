import { expect, test, chromium } from '@playwright/test'
import { preparePublicPlugin } from './real-stack-plugin'
import { createStackApi } from './stack-api'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'e2e-session-token'
// 与 native-server/examples/sample_plugin.cpp 的 /large 保持一致：8 MiB、字节值按 i % 251 生成。
const largeFileBytes = 8 * 1024 * 1024

type LocalUsage = { activeConnections: number; r2Objects: number; r2Bytes: number }

/** 让浏览器把插件域名解析到本地真实栈，从而按真实 Host 走 Worker 的域名路由。 */
function resolverRule(port: number) {
  return `--host-resolver-rules=MAP * 127.0.0.1:${port}`
}

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

test('真实浏览器经插件域名完成 HTTP、POST、SSE、WebSocket 与大文件下载', async ({ request }) => {
  test.setTimeout(300_000)
  const { api } = createStackApi(request, sessionToken)
  const { server, target } = await preparePublicPlugin(baseURL!, api)
  const usage = async () => (await (await api('/api/usage/local')).json()) as LocalUsage
  const browser = await chromium.launch({ args: [resolverRule(target.port)] })

  try {
    const page = await browser.newPage()
    const origin = `http://${target.host}`

    // 普通 HTTP：浏览器发出的是真实浏览器请求头，Worker 需按 Host 路由并原样透传插件响应。
    const navigation = await page.goto(`${origin}/`)
    expect(navigation?.status()).toBe(200)
    expect(await page.textContent('body')).toBe('ok')

    // POST 请求体与响应状态码：插件对任何请求都返回 ok，这里验证方法不被改写。
    const post = await page.evaluate(async () => {
      const response = await fetch('/echo', { method: 'POST', body: 'browser-body' })
      return { status: response.status, text: await response.text() }
    })
    expect(post).toEqual({ status: 200, text: 'ok' })

    // SSE：EventSource 自动携带 accept: text/event-stream，Worker 据此桥接插件流。
    const sse = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const source = new EventSource('/')
          const timer = setTimeout(() => {
            source.close()
            reject(new Error('EventSource 首个事件超时'))
          }, 10_000)
          source.onmessage = (event) => {
            clearTimeout(timer)
            source.close()
            resolve(event.data as string)
          }
        }),
    )
    expect(sse).toBe('sample-plugin')

    // 公开 WebSocket：浏览器原生 WebSocket 经 Worker → Durable Object → C++ → 插件回显。
    const echo = await page.evaluate(
      (url) =>
        new Promise<string>((resolve, reject) => {
          const socket = new WebSocket(url)
          // 插件回帧是二进制，浏览器默认把消息交给 Blob，这里改为 ArrayBuffer 后按 UTF-8 解码。
          socket.binaryType = 'arraybuffer'
          const timer = setTimeout(() => {
            socket.close()
            reject(new Error('WebSocket 回显超时'))
          }, 10_000)
          socket.onopen = () => socket.send('hello-ws')
          socket.onmessage = (event) => {
            clearTimeout(timer)
            socket.close()
            resolve(new TextDecoder().decode(event.data as ArrayBuffer))
          }
          socket.onerror = () => {
            clearTimeout(timer)
            reject(new Error('WebSocket 连接失败'))
          }
        }),
      `ws://${target.host}/`,
    )
    expect(echo).toBe('hello-ws')

    // 18 字节小文件：走 Durable Object 内存缓冲，不产生 R2 对象。
    const small = await page.evaluate(async () => {
      const response = await fetch('/file', { headers: { 'x-plugmesh-file-stream': 'true' } })
      return { status: response.status, type: response.headers.get('content-type'), text: await response.text() }
    })
    expect(small.status).toBe(200)
    expect(small.type).toContain('application/octet-stream')
    expect(small.text).toBe('sample-file-stream')

    // 8 MiB 大文件：浏览器流式读取，逐块校验字节，证明 R2 中转对真实浏览器透明。
    const large = await page.evaluate(async (expected) => {
      const response = await fetch('/large', { headers: { 'x-plugmesh-file-stream': 'true' } })
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let offset = 0
      let mismatch = -1
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (let index = 0; index < value.length; index += 1) {
          if (value[index] !== (offset + index) % 251 && mismatch < 0) mismatch = offset + index
        }
        offset += value.length
        chunks.push(value)
      }
      return { status: response.status, type: response.headers.get('content-type'), length: offset, mismatch, expected }
    }, largeFileBytes)
    expect(large.status).toBe(200)
    expect(large.type).toContain('application/octet-stream')
    expect(large.length).toBe(largeFileBytes)
    expect(large.mismatch).toBe(-1)

    // 读取与关闭后，活跃连接与 R2 用量必须归还。
    await expect
      .poll(async () => {
        const after = await usage()
        return `${after.activeConnections}/${after.r2Objects}/${after.r2Bytes}`
      }, { timeout: 30_000 })
      .toBe('0/0/0')

    const logs = (await (await api('/api/access-logs')).json()) as {
      results: Array<{ hostname: string; method: string; path: string; status: number }>
    }
    for (const [method, path] of [['GET', '/'], ['POST', '/echo'], ['GET', '/large']]) {
      expect(
        logs.results.find((entry) => entry.hostname === target.host && entry.method === method && entry.path === path && entry.status === 200),
        `访问日志应记录浏览器发起的 ${method} ${path} 200 请求`,
      ).toBeTruthy()
    }

    console.log('浏览器：HTTP 200 / POST 透传 / EventSource 收到 sample-plugin / WebSocket 回显 hello-ws / 8 MiB 流式下载逐字节一致')
  } finally {
    await browser.close()
    await server.stop()
  }
})
