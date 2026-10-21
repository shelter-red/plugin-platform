import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { getFileStream, makeTarget } from './public-client'
import { preparePublicPlugin } from './real-stack-plugin'
import { startRealServer } from './real-stack-server'
import { createStackApi } from './stack-api'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'e2e-session-token'

test.skip(!baseURL, '需要先启动本地真实栈并设置 PLUGMESH_REAL_STACK_URL')

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'plugmesh_session', value: sessionToken, url: baseURL! }])
})

test('管理端读取真实 Worker 数据并展示服务器、插件和域名', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '插件服务器', exact: true }).click()
  await expect(page.getByRole('heading', { name: '插件服务器', level: 1 })).toBeVisible()
  await expect(page.getByText('真实栈服务器')).toBeVisible()
  await expect(page.getByText('离线').first()).toBeVisible()

  await page.getByRole('button', { name: '插件实例', exact: true }).click()
  await expect(page.getByText('真实栈插件')).toBeVisible()
  await expect(page.getByText('real.plugin · v1.0.0')).toBeVisible()

  await page.getByRole('button', { name: '公开域名', exact: true }).click()
  await expect(page.getByText('real.plugins.example.com')).toBeVisible()
})

test('管理端邀请与注册码操作落到真实 D1', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用户与邀请' })).toBeVisible()

  const githubInput = page.getByPlaceholder('github-login')
  await expect(githubInput).toBeEnabled()
  const invitee = `real-invitee-${Date.now()}`
  await githubInput.fill(invitee)
  await page.getByRole('button', { name: '创建邀请' }).click()
  await expect(page.getByLabel('新创建的邀请链接')).toHaveValue(/\/auth\/github\/start\?invite=/)
  await expect(page.getByRole('row', { name: new RegExp(invitee) })).toBeVisible()

  await githubInput.fill('bad login!')
  await page.getByRole('button', { name: '创建邀请' }).click()
  await expect(page.getByText('邮箱或 GitHub 用户名至少填写一个，且格式必须有效')).toBeVisible()

  await page.getByRole('button', { name: '插件服务器', exact: true }).click()
  await page.getByRole('button', { name: '绑定服务器' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '生成注册码' }).click()
  await expect(page.locator('.code-value strong')).toHaveText(/[0-9a-f-]{20,}/)
})

test('管理端在真实 C++ 服务器上加载、启用插件并分配域名', async ({ page }) => {
  test.setTimeout(180_000)

  const codeResponse = await page.request.post('/api/registration-codes')
  expect(codeResponse.ok()).toBeTruthy()
  const { code } = (await codeResponse.json()) as { code: string }

  const server = await startRealServer(baseURL!, code)
  try {
    await expect
      .poll(async () => {
        const response = await page.request.get('/api/servers')
        const body = (await response.json()) as { results: Array<{ name: string; status: string }> }
        return body.results.find((item) => item.name === server.name)?.status
      }, { timeout: 30_000 })
      .toBe('online')

    await page.goto('/')
    await page.getByRole('button', { name: '插件实例', exact: true }).click()
    const pluginRow = page.getByRole('row', { name: new RegExp(`Sample Plugin.*${server.name}`) })
    await expect(pluginRow).toContainText('已发现')

    await page.locator('.header-actions').getByRole('button', { name: '加载插件' }).click()
    const loadDialog = page.getByRole('dialog', { name: '加载插件' })
    const loadOption = loadDialog.locator('option').filter({ hasText: 'sample.plugin' }).filter({ hasText: server.name })
    await loadDialog.locator('select').selectOption((await loadOption.getAttribute('value'))!)
    await loadDialog.getByRole('button', { name: '加载插件', exact: true }).click()
    await expect(loadDialog.getByRole('heading', { name: '加载命令已确认' })).toBeVisible()
    await expect(loadDialog.getByText('插件当前状态：loaded')).toBeVisible()
    await loadDialog.getByRole('button', { name: '关闭', exact: true }).click()

    await expect(pluginRow).toContainText('已加载')
    await pluginRow.getByRole('button', { name: '查看 Sample Plugin 详情' }).click()
    const detail = page.getByRole('dialog', { name: '插件实例详情' })
    await detail.getByRole('button', { name: '启用', exact: true }).click()
    await expect(page.getByText('Sample Plugin 已启用')).toBeVisible()
    await expect(detail.getByText('已启用').first()).toBeVisible()

    await detail.getByRole('button', { name: '健康检查', exact: true }).click()
    await expect(page.getByText(/Sample Plugin 健康检查通过（200，\d+ B）/)).toBeVisible()

    await detail.getByRole('button', { name: '重载', exact: true }).click()
    await expect(page.getByText('Sample Plugin 已重载')).toBeVisible()
    await expect(detail.getByText('已启用').first()).toBeVisible()
    await detail.getByRole('button', { name: '关闭详情' }).click()

    await page.getByRole('button', { name: '公开域名', exact: true }).click()
    await page.locator('.header-actions').getByRole('button', { name: '分配域名' }).click()
    const domainDialog = page.getByRole('dialog', { name: '分配公开域名' })
    const prefix = `console-${Date.now().toString(36)}`
    const hostname = `${prefix}.plugins.example.com`
    const domainOption = domainDialog.locator('option').filter({ hasText: 'sample.plugin' }).filter({ hasText: server.name })
    await domainDialog.locator('select').selectOption((await domainOption.getAttribute('value'))!)
    await domainDialog.getByPlaceholder('例如：my-plugin').fill(prefix)
    await domainDialog.getByRole('button', { name: '分配域名', exact: true }).click()
    await expect(domainDialog.getByRole('heading', { name: '公开域名已分配' })).toBeVisible()
    await expect(domainDialog.getByText(hostname)).toBeVisible()
    await domainDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.locator('.domain-row').filter({ hasText: hostname })).toContainText('在线')

    const publicResponse = await getPublic(baseURL!, hostname)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.body).toBe('ok')

    await page.getByRole('button', { name: '插件实例', exact: true }).click()
    await pluginRow.getByRole('button', { name: '查看 Sample Plugin 详情' }).click()
    const lifecycleDialog = page.getByRole('dialog', { name: '插件实例详情' })
    page.once('dialog', (dialog) => void dialog.accept())
    await lifecycleDialog.getByRole('button', { name: '卸载', exact: true }).click()
    await expect(page.getByText('Sample Plugin 已卸载')).toBeVisible()
    await expect(lifecycleDialog.getByText('已卸载').first()).toBeVisible()

    const suspended = await getPublic(baseURL!, hostname)
    expect(suspended.status).toBe(503)
  } finally {
    await server.stop()
  }
})

test('管理端总览展示真实 5xx 访问日志与连接异常', async ({ page }) => {
  test.setTimeout(180_000)
  const { call, api } = createStackApi(page.request, sessionToken)
  const prepared = await preparePublicPlugin(baseURL!, api)
  try {
    const servers = (await (await api('/api/servers')).json()) as { results: Array<{ id: string; name: string }> }
    const serverId = servers.results.find((item) => item.name === prepared.server.name)!.id
    const plugins = (await (await api('/api/plugins')).json()) as { results: Array<{ id: string; plugin_id: string; server_id: string }> }
    const lifecycle = plugins.results.find((item) => item.server_id === serverId && item.plugin_id === 'lifecycle.plugin')
    expect(lifecycle, 'lifecycle.plugin 应已注册到新服务器').toBeTruthy()

    await api(`/api/plugins/${lifecycle!.id}/load`, { method: 'POST' })
    await expect.poll(async () => ((await (await api(`/api/plugins/${lifecycle!.id}`)).json()) as { plugin: { state: string } }).plugin.state, { timeout: 60_000 }).toBe('loaded')
    await api(`/api/plugins/${lifecycle!.id}/enable`, { method: 'POST' })
    await expect.poll(async () => ((await (await api(`/api/plugins/${lifecycle!.id}`)).json()) as { plugin: { state: string } }).plugin.state, { timeout: 60_000 }).toBe('enabled')

    const prefix = `overview-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
    const { hostname } = (await (await api('/api/domains', { method: 'POST', data: { pluginInstanceId: lifecycle!.id, prefix } })).json()) as { hostname: string }
    expect(hostname).toBe(`${prefix}.plugins.example.com`)

    // lifecycle.plugin 未声明 fileStream 能力，文件流请求应被 Worker 以 501 拒绝并写入访问日志。
    expect((await getFileStream(makeTarget(baseURL!, hostname))).status).toBe(501)
    await expect.poll(async () => {
      const body = (await (await call('/api/access-logs')).json()) as { results: Array<{ hostname: string; status: number; error: string | null }> }
      return body.results.some((log) => log.hostname === hostname && log.status === 501 && log.error === 'plugin capability unavailable')
    }, { timeout: 30_000 }).toBe(true)

    await page.goto('/')
    const panel = page.locator('section.panel', { has: page.getByRole('heading', { name: '最近错误和连接异常' }) })
    const errorRow = panel.locator('.activity-item').filter({ hasText: hostname })
    await expect(errorRow).toContainText('501')
    await expect(errorRow).toContainText('plugin capability unavailable')

    await page.getByRole('button', { name: '访问日志', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: hostname })).toContainText('501')
    await expect(page.getByText(/错误 \d+ 条/)).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出日志' }).click()
    const csvFile = test.info().outputPath('access-logs.csv')
    await (await downloadPromise).saveAs(csvFile)
    const csv = await readFile(csvFile, 'utf8')
    expect(csv).toContain(hostname)
    expect(csv).toContain('plugin capability unavailable')

    await prepared.server.stop()
    await expect.poll(async () => {
      const body = (await (await api('/api/servers')).json()) as { results: Array<{ name: string; status: string }> }
      return body.results.find((item) => item.name === prepared.server.name)?.status
    }, { timeout: 60_000 }).toBe('offline')

    await page.reload()
    await expect(panel.locator('.activity-item').filter({ hasText: prepared.server.name })).toContainText('离线')

    await page.getByRole('button', { name: '插件服务器', exact: true }).click()
    await page.getByRole('button', { name: `查看 ${prepared.server.name} 详情` }).click()
    const serverDetail = page.getByRole('dialog', { name: '服务器详情' })
    await expect(serverDetail).toContainText('离线')
    await expect(serverDetail).toContainText('服务器离线')
    const detailError = serverDetail.locator('.detail-error').filter({ hasText: hostname })
    await expect(detailError).toContainText('501')
    await expect(detailError).toContainText('plugin capability unavailable')
    await serverDetail.getByRole('button', { name: '关闭详情' }).click()
  } finally {
    await prepared.server.stop()
  }
})

test('管理端维护开关与配额保存落到真实平台状态并写入审计', async ({ page }) => {
  const { call } = createStackApi(page.request, sessionToken)
  const original = (await (await call('/api/settings/platform')).json()) as { maintenance: boolean; quotas: Record<string, number> }
  expect(original.maintenance, '真实栈应处于运行状态').toBe(false)
  try {
    await page.goto('/')
    await page.getByRole('button', { name: '系统设置', exact: true }).click()
    await page.getByRole('button', { name: '维护与配额' }).click()
    const panel = page.locator('#settings-maintenance')
    await expect(panel).toContainText('运行中')

    await panel.locator('button.toggle').click()
    await expect(page.getByText('平台已进入维护模式')).toBeVisible()
    await expect(panel).toContainText('维护中')

    const paused = await getPublic(baseURL!, 'maintenance-check.plugins.example.com')
    expect(paused.status).toBe(503)
    expect(paused.body).toContain('平台维护中')

    await page.getByRole('button', { name: '总览', exact: true }).click()
    await expect(page.getByText('平台维护中', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '系统设置', exact: true }).click()
    await page.getByRole('button', { name: '维护与配额' }).click()
    await panel.locator('button.toggle').click()
    await expect(page.getByText('平台已恢复运行')).toBeVisible()

    const resumed = await getPublic(baseURL!, 'maintenance-check.plugins.example.com')
    expect(resumed.status).toBe(404)

    const raisedQuota = 5_000_000
    const quotaInput = panel.getByLabel('请求数 / 24 小时')
    await quotaInput.fill(String(raisedQuota))
    await panel.getByRole('button', { name: '保存配额' }).click()
    await expect(page.getByText('平台配额已保存')).toBeVisible()
    const saved = (await (await call('/api/settings/platform')).json()) as { quotas: { requests: number } }
    expect(saved.quotas.requests).toBe(raisedQuota)

    await page.getByRole('button', { name: '用量与配额', exact: true }).click()
    await expect(page.locator('.resource-card').filter({ hasText: '平台请求计数' }))
      .toContainText(`上限 ${raisedQuota.toLocaleString('zh-CN')}`)

    // 配额必须回源 D1：整页重载后表单仍显示新值，而不是只存在内存状态里。
    await page.reload()
    await page.getByRole('button', { name: '系统设置', exact: true }).click()
    await page.getByRole('button', { name: '维护与配额' }).click()
    await expect(page.locator('#settings-maintenance').getByLabel('请求数 / 24 小时')).toHaveValue(String(raisedQuota))

    await page.getByRole('button', { name: '审计日志', exact: true }).click()
    await expect(page.getByRole('row', { name: /更新平台设置/ }).first()).toBeVisible()
  } finally {
    await call('/api/settings/platform', { method: 'PUT', data: { maintenance: false, quotas: original.quotas } })
  }
})

test('管理端用量与配额页展示真实本地计数与官方未连接状态', async ({ page }) => {
  const { call } = createStackApi(page.request, sessionToken)
  const official = (await (await call('/api/usage/cloudflare')).json()) as { configured: boolean }
  expect(official.configured, '真实栈应处于 Cloudflare 官方数据未连接状态').toBe(false)

  const before = (await (await call('/api/usage/local')).json()) as { requestCount: number }
  // POST /api/blobs 会先占用一次请求配额并写入真实 R2 用量，用于验证页面计数不是伪造值。
  const upload = await page.request.post('/api/blobs', {
    headers: { 'content-type': 'application/octet-stream', 'content-length': '5' },
    data: Buffer.from('hello'),
  })
  expect(upload.status()).toBe(201)
  const { url: blobUrl } = (await upload.json()) as { url: string }

  let counted = before.requestCount
  try {
    await expect.poll(async () => {
      const local = (await (await call('/api/usage/local')).json()) as { requestCount: number; r2Objects: number }
      counted = local.requestCount
      return local.requestCount === before.requestCount + 1 && local.r2Objects >= 1
    }, { timeout: 15_000 }).toBe(true)

    await page.goto('/')
    await page.getByRole('button', { name: '用量与配额', exact: true }).click()
    await expect(page.getByRole('heading', { name: '用量与配额', level: 1 })).toBeVisible()
    await expect(page.getByText('用量读取失败')).toHaveCount(0)

    const cards = page.locator('.resource-card')
    await expect(cards.filter({ hasText: 'Worker 请求' })).toContainText('—')
    await expect(page.getByText('官方数据尚未连接')).toBeVisible()

    const platformCard = cards.filter({ hasText: '平台请求计数' })
    await expect(platformCard).toContainText(counted.toLocaleString('zh-CN'))
    await expect(platformCard).toContainText('24 小时窗口')

    const r2Card = cards.filter({ hasText: 'R2 存储' })
    await expect(r2Card).toContainText('1 个对象')
    await expect(cards.filter({ hasText: '活跃连接' })).toContainText('WebSocket / SSE')

    const sources = page.locator('.source-row')
    await expect(sources.filter({ hasText: 'Cloudflare Analytics API' })).toContainText('未配置')
    await expect(sources.filter({ hasText: '本地计数' })).toContainText('更新于')
    await expect(sources.filter({ hasText: '本地计数' })).toContainText('窗口始于')

    const consumed = await page.request.get(blobUrl)
    expect(consumed.status()).toBe(200)
    expect(await consumed.text()).toBe('hello')
    await expect.poll(async () => {
      const local = (await (await call('/api/usage/local')).json()) as { r2Bytes: number; r2Objects: number }
      return local.r2Objects === 0 && local.r2Bytes === 0
    }, { timeout: 15_000 }).toBe(true)

    await page.reload()
    await page.getByRole('button', { name: '用量与配额', exact: true }).click()
    await expect(page.locator('.resource-card').filter({ hasText: 'R2 存储' })).toContainText('0 个对象')
  } finally {
    // 断言失败时也要消费临时对象，避免把 R2 用量留在共享真实栈里。
    await page.request.get(blobUrl).catch(() => undefined)
  }
})

function getPublic(workerUrl: string, hostname: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const target = new URL(workerUrl)
    const request = http.request(
      { hostname: target.hostname, port: target.port, path: '/', headers: { host: hostname } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}
