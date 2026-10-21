import { expect, test } from '@playwright/test'
import { echoOnce, getFileStream, openEcho, openFileStream, openStream, readBody } from './public-client'
import { preparePublicPlugin } from './real-stack-plugin'
import { createStackApi } from './stack-api'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'e2e-session-token'
// 与 native-server/examples/sample_plugin.cpp 的 /large 保持一致：8 MiB、字节值按 i % 251 生成。
const largeFileBytes = 8 * 1024 * 1024

type LocalUsage = { activeConnections: number; r2Objects: number; r2Bytes: number }
type AccessLog = { hostname: string; method: string; path: string; status: number }

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

test('真实栈桥接 SSE、WebSocket 与文件流，大文件经 R2 中转并归还用量', async ({ request }) => {
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

    // 18 字节小文件低于 1 MiB 阈值，走 Durable Object 内存缓冲直返，不产生 R2 对象。
    const small = await getFileStream(target, '/file')
    expect(small.status).toBe(200)
    expect(small.headers['content-type']).toContain('application/octet-stream')
    expect(small.bytes.length).toBe(18)
    expect(small.body).toBe('sample-file-stream')

    // 8 MiB 大文件超过阈值：先暂停读取，此时对象必须仍在 R2 中并计入用量。
    const large = await openFileStream(target, '/large')
    try {
      expect(large.headers['content-type']).toContain('application/octet-stream')
      await expect.poll(async () => (await usage()).r2Objects, { timeout: 30_000 }).toBe(1)
      expect((await usage()).r2Bytes, '暂停读取时 R2 应保留正在中转的字节').toBeGreaterThanOrEqual(largeFileBytes)

      const body = await readBody(large)
      expect(body.length).toBe(largeFileBytes)
      for (let index = 0; index < body.length; index += 1) {
        if (body[index] !== index % 251) throw new Error(`大文件第 ${index} 字节为 ${body[index]}，期望 ${index % 251}`)
      }
    } finally {
      large.destroy()
    }

    // 读取完成后对象与用量必须归还。
    await expect
      .poll(async () => {
        const after = await usage()
        return `${after.r2Objects}/${after.r2Bytes}`
      }, { timeout: 30_000 })
      .toBe('0/0')

    const logs = (await (await api('/api/access-logs')).json()) as { results: AccessLog[] }
    for (const path of ['/file', '/large']) {
      expect(
        logs.results.find((entry) => entry.hostname === target.host && entry.path === path && entry.status === 200),
        `访问日志应记录 ${path} 200 请求`,
      ).toBeTruthy()
    }

    console.log('SSE 首帧 data: sample-plugin；WebSocket 回显 hello-ws；18 字节小文件直返；8 MiB 大文件经 R2 中转，读取后 r2Objects/r2Bytes 归零')
  } finally {
    await server.stop()
  }
})
