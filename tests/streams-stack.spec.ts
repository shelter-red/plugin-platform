import { expect, test } from '@playwright/test'
import { echoOnce, getFileStream, openEcho, openStream } from './public-client'
import { preparePublicPlugin } from './real-stack-plugin'
import { createStackApi } from './stack-api'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'e2e-session-token'

type LocalUsage = { activeConnections: number; r2Objects: number; r2Bytes: number }
type AccessLog = { hostname: string; method: string; path: string; status: number }

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

test('真实栈桥接 SSE、WebSocket 与文件流并在结束后归还 R2 用量', async ({ request }) => {
  test.setTimeout(300_000)
  const { api } = createStackApi(request, sessionToken)

  const { server, target } = await preparePublicPlugin(baseURL!, api)
  const usage = async () => (await (await api('/api/usage/local')).json()) as LocalUsage
  try {
    const baseline = await usage()
    expect(baseline.r2Objects, '基线不应残留 R2 中转对象').toBe(0)
    expect(baseline.r2Bytes, '基线不应残留 R2 中转字节').toBe(0)

    // SSE：示例插件写一帧后结束，断言响应类型与首帧内容。
    const stream = await openStream(target)
    try {
      expect(stream.response.headers['content-type']).toContain('text/event-stream')
      expect(stream.first).toContain('data: sample-plugin')
    } finally {
      stream.response.destroy()
    }

    // WebSocket：经 Worker → Durable Object → C++ → 插件完整回显。
    const socket = await openEcho(target)
    try {
      expect(await echoOnce(socket, 'hello-ws')).toBe('hello-ws')
    } finally {
      socket.close()
    }
    await expect.poll(async () => (await usage()).activeConnections, { timeout: 30_000 }).toBe(0)

    // 文件流：18 字节二进制经 R2 中转，读取后对象和字节数必须归还。
    const file = await getFileStream(target, '/file')
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('application/octet-stream')
    expect(file.bytes.length).toBe(18)
    expect(file.body).toBe('sample-file-stream')
    await expect
      .poll(async () => {
        const after = await usage()
        return `${after.r2Objects}/${after.r2Bytes}`
      }, { timeout: 30_000 })
      .toBe('0/0')

    const logs = (await (await api('/api/access-logs')).json()) as { results: AccessLog[] }
    expect(
      logs.results.find((entry) => entry.hostname === target.host && entry.path === '/file' && entry.status === 200),
      '访问日志应记录文件流请求',
    ).toBeTruthy()

    console.log('SSE 首帧 data: sample-plugin；WebSocket 回显 hello-ws；文件流 18 字节 sample-file-stream；结束后 R2 用量归零')
  } finally {
    await server.stop()
  }
})
