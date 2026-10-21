import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { getPublic } from './public-client'
import { preparePublicPlugin } from './real-stack-plugin'
import { createStackApi } from './stack-api'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'e2e-session-token'
const container = process.env.PLUGMESH_E2E_CONTAINER

test.skip(!baseURL || !container, '需要本地真实栈并设置 PLUGMESH_REAL_STACK_URL 与 PLUGMESH_E2E_CONTAINER')

test('Worker 重启后路由缓存从 D1 冷回源并恢复插件公开入口', async ({ request }) => {
  test.setTimeout(300_000)
  const { api } = createStackApi(request, sessionToken)

  const { server, target } = await preparePublicPlugin(baseURL!, api)
  try {
    // 预热本 isolate 的路由缓存，确认重启前链路正常。
    expect((await getPublic(target)).status).toBe(200)

    execFileSync('docker', ['restart', container!], { stdio: 'ignore' })

    await expect
      .poll(async () => {
        try {
          return (await request.get(`${baseURL}/api/health`)).status()
        } catch {
          return 0
        }
      }, { timeout: 120_000, intervals: [500, 1_000, 2_000] })
      .toBe(200)

    // 重启后的 isolate 没有任何内存路由，公开入口必须回源 D1 并等待真实服务器重连。
    await expect.poll(async () => (await getPublic(target)).status, { timeout: 120_000 }).toBe(200)
    const restored = await getPublic(target)
    expect(restored.status).toBe(200)
    expect(restored.body).toContain('ok')

    await expect
      .poll(async () => {
        const body = (await (await api('/api/servers')).json()) as { results: Array<{ name: string; status: string }> }
        return body.results.find((item) => item.name === server.name)?.status
      }, { timeout: 120_000 })
      .toBe('online')
    console.log('重启：缓存清空后回源 D1，真实服务器自动重连，公开入口恢复 200')
  } finally {
    await server.stop()
  }
})
