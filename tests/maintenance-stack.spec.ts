import { expect, test } from '@playwright/test'
import { echoOnce, getPublic, openEcho, upgradeStatus } from './public-client'
import { preparePublicPlugin } from './real-stack-plugin'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'real-stack-session-token'

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

test('请求配额耗尽后进入维护模式并拒绝新的长连接', async ({ request }) => {
  test.setTimeout(300_000)
  const cookie = `plugmesh_session=${sessionToken}`
  const call = (path: string, init: RequestInit = {}) => request.fetch(path, { ...init, headers: { cookie, ...(init.headers ?? {}) } })
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await call(path, init)
    if (!response.ok()) throw new Error(`${init.method ?? 'GET'} ${path} 失败：${response.status()} ${await response.text()}`)
    return response
  }

  const baseline = (await (await api('/api/settings/platform')).json()) as { maintenance: boolean; quotas: Record<string, number> }
  expect(baseline.maintenance, '维护模式用例要求平台初始不在维护中').toBe(false)

  const { server, pluginId, target } = await preparePublicPlugin(baseURL!, api)
  try {
    const resident = await openEcho(target)
    expect(await echoOnce(resident, 'before-maintenance')).toBe('before-maintenance')

    // 当前窗口的请求计数已远超 1，把配额压到 1 后下一次公开请求必然耗尽配额。
    await api('/api/settings/platform', { method: 'PUT', data: { quotas: { ...baseline.quotas, requests: 1 } } })

    const blocked = await getPublic(target)
    expect(blocked.status).toBe(503)
    expect(blocked.headers['retry-after']).toBe('300')
    expect(String(blocked.headers['content-type'])).toContain('text/html')
    expect(blocked.body).toContain('平台维护中')

    expect(await upgradeStatus(target), '维护模式下新的 WebSocket 升级应被拒绝').toBe(503)
    expect(await echoOnce(resident, 'during-maintenance'), '已建立的长连接不应被维护模式切断').toBe('during-maintenance')

    const settings = (await (await api('/api/settings/platform')).json()) as { maintenance: boolean }
    expect(settings.maintenance).toBe(true)

    expect((await call('/api/registration-codes', { method: 'POST' })).status(), '维护中不再发放注册码').toBe(503)
    expect((await call(`/api/plugins/${pluginId}/reload`, { method: 'POST' })).status(), '维护中拒绝插件命令').toBe(503)
    expect((await call('/api/domains', { method: 'POST', data: { pluginInstanceId: pluginId, prefix: `blocked-${Date.now().toString(36)}` } })).status(), '维护中拒绝新增域名').toBe(503)

    const audit = (await (await api('/api/audit')).json()) as { results: Array<{ action: string; detail_json: string }> }
    const notice = audit.results.find((row) => row.action.startsWith('maintenance.email.'))
    expect(notice, '配额触发维护应留下维护通知审计').toBeTruthy()
    expect(JSON.parse(notice!.detail_json).reason).toBe('request quota reached')

    await api('/api/settings/platform', { method: 'PUT', data: { maintenance: false, quotas: baseline.quotas } })
    await expect.poll(async () => (await getPublic(target)).status, { timeout: 30_000 }).toBe(200)
    const restored = await openEcho(target)
    expect(await echoOnce(restored, 'after-maintenance')).toBe('after-maintenance')

    restored.close()
    resident.close()
    await expect.poll(async () => ((await (await api('/api/usage/local')).json()) as { activeConnections: number }).activeConnections, { timeout: 30_000 }).toBe(0)
    console.log('配额耗尽：503 维护页 + Retry-After、新 WebSocket 被拒、已建连接保持、管理 API 记录审计并可解除维护')
  } finally {
    await server.stop()
  }
})
