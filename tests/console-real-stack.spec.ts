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
  // 邀请链接与公开域名都有「复制」按钮，Playwright 需显式授权才能读回剪贴板校验。
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL! })
})

test('管理端读取真实 Worker 数据并展示服务器、插件和域名', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()

  await page.getByRole('menuitem', { name: '插件服务器', exact: true }).click()
  await expect(page.getByRole('heading', { name: '插件服务器', level: 1 })).toBeVisible()
  await expect(page.getByText('真实栈服务器')).toBeVisible()
  await expect(page.getByText('离线').first()).toBeVisible()

  await page.getByRole('menuitem', { name: '插件实例', exact: true }).click()
  await expect(page.getByText('真实栈插件')).toBeVisible()
  await expect(page.getByText('real.plugin · v1.0.0')).toBeVisible()

  await page.getByRole('menuitem', { name: '公开域名', exact: true }).click()
  await expect(page.getByText('real.plugins.example.com')).toBeVisible()
})

test('管理端邀请与注册码操作落到真实 D1', async ({ page }) => {
  const { call } = createStackApi(page.request, sessionToken)

  await page.goto('/')
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用户与邀请' })).toBeVisible()

  const githubInput = page.getByPlaceholder('github-login')
  await expect(githubInput).toBeEnabled()
  const invitee = `real-invitee-${Date.now()}`
  await githubInput.fill(invitee)
  await page.getByRole('button', { name: '创建邀请' }).click()
  const inviteLink = page.getByLabel('新创建的邀请链接')
  await expect(inviteLink).toHaveValue(/\/auth\/github\/start\?invite=/)
  const inviteUrl = await inviteLink.inputValue()

  await page.getByRole('button', { name: '复制链接' }).click()
  await expect(page.getByText('邀请链接已复制')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl)

  const inviteRow = page.getByRole('row', { name: new RegExp(invitee) })
  await expect(inviteRow).toBeVisible()
  const pendingInvites = (await (await call('/api/invites')).json()) as {
    results: Array<{ id: string; github_login: string | null; status: string }>
  }
  const invite = pendingInvites.results.find((item) => item.github_login === invitee)
  expect(invite?.status).toBe('pending')

  await githubInput.fill('bad login!')
  await page.getByRole('button', { name: '创建邀请' }).click()
  await expect(page.getByText('邮箱或 GitHub 用户名至少填写一个，且格式必须有效')).toBeVisible()

  await inviteRow.getByRole('button', { name: '撤销邀请' }).click()
  // 撤销邀请走 AntD Modal.confirm，而不是原生 window.confirm。
  await page.getByRole('dialog').filter({ hasText: '撤销这个仍未使用的邀请' }).getByRole('button', { name: '撤销邀请', exact: true }).click()
  await expect(page.getByText('邀请已撤销')).toBeVisible()
  await expect(inviteRow).toContainText('已撤销')
  await expect(inviteRow.getByRole('button', { name: '撤销邀请' })).toHaveCount(0)

  const revokedInvites = (await (await call('/api/invites')).json()) as { results: Array<{ id: string; status: string }> }
  expect(revokedInvites.results.find((item) => item.id === invite!.id)?.status).toBe('revoked')
  // 非 pending 的邀请不能再次撤销，Worker 返回 409 而不是静默成功。
  expect((await call(`/api/invites/${invite!.id}`, { method: 'DELETE' })).status()).toBe(409)

  // 撤销状态来自 D1：整页重载后列表仍显示已撤销。
  await page.reload()
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await expect(page.getByRole('row', { name: new RegExp(invitee) })).toContainText('已撤销')

  await page.getByRole('menuitem', { name: '审计日志', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: invite!.id }).first()).toContainText('撤销平台邀请')

  await page.getByRole('menuitem', { name: '插件服务器', exact: true }).click()
  await page.getByRole('button', { name: '绑定服务器' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '生成注册码' }).click()
  await expect(page.locator('.code-value strong')).toHaveText(/[0-9a-f-]{20,}/)
})

test('管理端在真实 C++ 服务器上加载、启停插件并分配域名', async ({ page }) => {
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
    await page.getByRole('menuitem', { name: '插件实例', exact: true }).click()
    const pluginRow = page.getByRole('row', { name: new RegExp(`Sample Plugin.*${server.name}`) })
    await expect(pluginRow).toContainText('已发现')

    const pluginId = (await (await page.request.get('/api/plugins')).json() as { results: Array<{ id: string; plugin_id: string; server_name: string }> }).results.find((item) => item.plugin_id === 'sample.plugin' && item.server_name === server.name)!.id
    await page.locator('.header-actions').getByRole('button', { name: '加载插件' }).click()
    const loadDialog = page.getByRole('dialog', { name: '加载插件' })
    await loadDialog.getByRole('combobox').click()
    await page.locator('.ant-select-item-option').filter({ hasText: 'sample.plugin' }).filter({ hasText: server.name }).click()
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

    await page.getByRole('menuitem', { name: '公开域名', exact: true }).click()
    await page.locator('.header-actions').getByRole('button', { name: '分配域名' }).click()
    const domainDialog = page.getByRole('dialog', { name: '分配公开域名' })
    const prefix = `console-${Date.now().toString(36)}`
    const hostname = `${prefix}.plugins.example.com`
    await domainDialog.getByRole('combobox').click()
    await page.locator('.ant-select-item-option').filter({ hasText: 'sample.plugin' }).filter({ hasText: server.name }).click()
    await domainDialog.getByPlaceholder('例如：my-plugin').fill(prefix)
    await domainDialog.getByRole('button', { name: '分配域名', exact: true }).click()
    await expect(domainDialog.getByRole('heading', { name: '公开域名已分配' })).toBeVisible()
    await expect(domainDialog.getByText(hostname)).toBeVisible()
    await domainDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.locator('.domain-row').filter({ hasText: hostname })).toContainText('在线')

    const publicResponse = await getPublic(baseURL!, hostname)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.body).toBe('ok')

    // 停用后公开入口立即降级为维护页，重新启用后恢复转发（状态写真实 D1）。
    await page.getByRole('menuitem', { name: '插件实例', exact: true }).click()
    await pluginRow.getByRole('button', { name: '查看 Sample Plugin 详情' }).click()
    const lifecycleDialog = page.getByRole('dialog', { name: '插件实例详情' })
    await lifecycleDialog.getByRole('button', { name: '停用', exact: true }).click()
    await expect(page.getByText('Sample Plugin 已停用')).toBeVisible()
    await expect(lifecycleDialog.getByText('已停用').first()).toBeVisible()
    await expect.poll(async () => ((await (await page.request.get(`/api/plugins/${pluginId}`)).json()) as { plugin: { state: string } }).plugin.state).toBe('disabled')

    const disabledPublic = await getPublic(baseURL!, hostname)
    expect(disabledPublic.status).toBe(503)
    expect(disabledPublic.body).toContain('插件暂时不可用')

    await lifecycleDialog.getByRole('button', { name: '启用', exact: true }).click()
    await expect(page.getByText('Sample Plugin 已启用')).toBeVisible()
    await expect.poll(async () => ((await (await page.request.get(`/api/plugins/${pluginId}`)).json()) as { plugin: { state: string } }).plugin.state).toBe('enabled')
    // 生命周期命令会把该插件的域名状态置回 offline，健康检查通过后公开入口才恢复转发。
    expect((await getPublic(baseURL!, hostname)).status).toBe(503)
    await lifecycleDialog.getByRole('button', { name: '健康检查', exact: true }).click()
    await expect(page.getByText(/Sample Plugin 健康检查通过/)).toBeVisible()
    await expect.poll(async () => (await getPublic(baseURL!, hostname)).status, { timeout: 15_000 }).toBe(200)

    await lifecycleDialog.getByRole('button', { name: '卸载', exact: true }).click()
    // 卸载确认同样使用 AntD Modal.confirm。
    await page.getByRole('dialog').filter({ hasText: '卸载插件' }).getByRole('button', { name: '卸载', exact: true }).click()
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

    // 公开域名行的复制按钮必须写入真实剪贴板，而不是只弹 Toast。
    await page.goto('/')
    await page.getByRole('menuitem', { name: '公开域名', exact: true }).click()
    const domainRow = page.locator('.domain-row').filter({ hasText: hostname })
    await expect(domainRow).toContainText('在线')
    await domainRow.getByRole('button', { name: `复制 ${hostname}` }).click()
    await expect(page.getByText('公开域名已复制')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hostname)

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

    await page.getByRole('menuitem', { name: '访问日志', exact: true }).click()
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

    await page.getByRole('menuitem', { name: '插件服务器', exact: true }).click()
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
  const original = (await (await call('/api/settings/platform')).json()) as { maintenance: boolean; quotas: Record<string, number>; cloudflareQuotas: Record<string, number> }
  expect(original.maintenance, '真实栈应处于运行状态').toBe(false)
  try {
    await page.goto('/')
    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('button', { name: '维护与配额' }).click()
    const panel = page.locator('#settings-maintenance')
    await expect(panel).toContainText('运行中')

    await panel.locator('button.toggle').click()
    await expect(page.getByText('平台已进入维护模式')).toBeVisible()
    await expect(panel).toContainText('维护中')

    const paused = await getPublic(baseURL!, 'maintenance-check.plugins.example.com')
    expect(paused.status).toBe(503)
    expect(paused.body).toContain('平台维护中')

    await page.getByRole('menuitem', { name: '总览', exact: true }).click()
    await expect(page.getByText('平台维护中', { exact: true })).toBeVisible()

    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('button', { name: '维护与配额' }).click()
    await panel.locator('button.toggle').click()
    await expect(page.getByText('平台已恢复运行')).toBeVisible()

    const resumed = await getPublic(baseURL!, 'maintenance-check.plugins.example.com')
    expect(resumed.status).toBe(404)

    // 平台请求不设上限，可调的是 Cloudflare 免费额度逐项阈值；这里下调 D1 行读取。
    const raisedQuota = 4_000_000
    const quotaInput = panel.getByLabel('D1 行读取 / 日')
    await quotaInput.fill(String(raisedQuota))
    await panel.getByRole('button', { name: '保存配额' }).first().click()
    await expect(page.getByText('平台配额已保存')).toBeVisible()
    const saved = (await (await call('/api/settings/platform')).json()) as { cloudflareQuotas: { d1RowsRead: number } }
    expect(saved.cloudflareQuotas.d1RowsRead).toBe(raisedQuota)

    await page.getByRole('menuitem', { name: '用量与配额', exact: true }).click()
    await expect(page.locator('.resource-card').filter({ hasText: 'D1 行读取' }))
      .toContainText(`上限 ${raisedQuota.toLocaleString('zh-CN')}`)

    // 配额必须回源 D1：整页重载后表单仍显示新值，而不是只存在内存状态里。
    await page.reload()
    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('button', { name: '维护与配额' }).click()
    await expect(page.locator('#settings-maintenance').getByLabel('D1 行读取 / 日')).toHaveValue(String(raisedQuota))

    await page.getByRole('menuitem', { name: '审计日志', exact: true }).click()
    await expect(page.getByRole('row', { name: /更新平台设置/ }).first()).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出日志' }).click()
    const csvFile = test.info().outputPath('audit-logs.csv')
    await (await downloadPromise).saveAs(csvFile)
    const csv = await readFile(csvFile, 'utf8')
    expect(csv.startsWith('\uFEFF'), 'CSV 应带 UTF-8 BOM，便于表格软件直接打开').toBe(true)
    expect(csv).toContain('"platform.settings.updated"')
    expect(csv).toContain('E2E Admin')
    expect(csv).toContain('e2e@example.com')
  } finally {
    await call('/api/settings/platform', { method: 'PUT', data: { maintenance: false, quotas: original.quotas, cloudflareQuotas: original.cloudflareQuotas } })
  }
})

test('管理端用量与配额页展示真实本地计数、分布与官方未连接状态', async ({ page }) => {
  test.setTimeout(180_000)
  type BreakdownEntry = { id: string; label: string; requests: number }
  type LocalUsage = { requestCount: number; r2Bytes: number; r2Objects: number; breakdown: { users: BreakdownEntry[]; plugins: BreakdownEntry[]; domains: BreakdownEntry[] } }
  const { call, api } = createStackApi(page.request, sessionToken)
  const official = (await (await call('/api/usage/cloudflare')).json()) as { configured: boolean }
  expect(official.configured, '真实栈应处于 Cloudflare 官方数据未连接状态').toBe(false)
  const readUsage = async (): Promise<LocalUsage> => (await (await call('/api/usage/local')).json()) as LocalUsage

  // 先拉起真实插件域名，后面用它验证本地计数按用户维度的增量来自真实请求日志。
  const prepared = await preparePublicPlugin(baseURL!, api)
  const before = await readUsage()
  // POST /api/blobs 会先累计一次平台请求计数并写入真实 R2 用量，用于验证页面计数不是伪造值。
  const upload = await page.request.post('/api/blobs', {
    headers: { 'content-type': 'application/octet-stream', 'content-length': '5' },
    data: Buffer.from('hello'),
  })
  expect(upload.status()).toBe(201)
  const { url: blobUrl } = (await upload.json()) as { url: string }

  let counted = before.requestCount
  try {
    await expect.poll(async () => {
      const local = await readUsage()
      counted = local.requestCount
      return local.requestCount === before.requestCount + 1 && local.r2Objects >= 1
    }, { timeout: 15_000 }).toBe(true)

    await page.goto('/')
    await page.getByRole('menuitem', { name: '用量与配额', exact: true }).click()
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
      const local = await readUsage()
      return local.r2Objects === 0 && local.r2Bytes === 0
    }, { timeout: 15_000 }).toBe(true)

    await page.reload()
    await page.getByRole('menuitem', { name: '用量与配额', exact: true }).click()
    await expect(page.locator('.resource-card').filter({ hasText: 'R2 存储' })).toContainText('0 个对象')

    // 本地分布按用户聚合：对刚就绪的公开域名再发 3 次请求，该用户请求数必须精确增加 3。
    const adminBefore = before.breakdown.users.find((entry) => entry.label === 'E2E Admin')
    expect(adminBefore, '真实栈管理员的公开请求应写入 request_logs').toBeTruthy()
    for (let index = 0; index < 3; index += 1) expect((await getPublic(baseURL!, prepared.target.host)).status).toBe(200)
    await expect.poll(async () => {
      const users = (await readUsage()).breakdown.users
      return users.find((entry) => entry.id === adminBefore!.id)?.requests
    }, { timeout: 30_000 }).toBe(adminBefore!.requests + 3)

    const breakdown = (await readUsage()).breakdown
    const descending = (rows: BreakdownEntry[]) => rows.every((row, index) => index === 0 || rows[index - 1].requests >= row.requests)
    expect(descending(breakdown.plugins), '插件分布应按请求数降序').toBe(true)
    expect(descending(breakdown.domains), '域名分布应按请求数降序').toBe(true)
    expect(breakdown.domains.some((entry) => entry.id.endsWith('.plugins.example.com')), '域名分布应来自真实公开域名').toBe(true)

    await page.reload()
    await page.getByRole('menuitem', { name: '用量与配额', exact: true }).click()
    const panel = page.locator('.breakdown-panel')
    await expect(panel.getByRole('heading', { name: '本地请求分布' })).toBeVisible()
    // 刚产生过真实公开请求，三个维度都应至少返回一行。
    expect(breakdown.users.length).toBeGreaterThan(0)
    expect(breakdown.plugins.length).toBeGreaterThan(0)
    expect(breakdown.domains.length).toBeGreaterThan(0)
    const users = breakdown.users[0]!
    const plugins = breakdown.plugins[0]!
    const domains = breakdown.domains[0]!
    await expect(panel.locator('.breakdown-column').filter({ hasText: '用户' })).toContainText(users.label)
    await expect(panel.locator('.breakdown-column').filter({ hasText: '用户' })).toContainText(users.requests.toLocaleString('zh-CN'))
    await expect(panel.locator('.breakdown-column').filter({ hasText: '插件' })).toContainText(plugins.label)
    await expect(panel.locator('.breakdown-column').filter({ hasText: '域名' })).toContainText(domains.label)
  } finally {
    // 断言失败时也要消费临时对象并停掉临时服务器，避免把用量和进程留在共享真实栈里。
    await page.request.get(blobUrl).catch(() => undefined)
    await prepared.server.stop()
  }
})

test('管理端在后台保存 OAuth 配置到真实 D1 且不回显密钥', async ({ page }) => {
  const { call } = createStackApi(page.request, sessionToken)
  await call('/api/settings/oauth?provider=all', { method: 'DELETE' })
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
  const clientId = `real-github-${suffix}`
  const clientSecret = `real-secret-${suffix}`
  const redirectUri = `${baseURL}/auth/github/callback`
  const allowlist = `admin-${suffix}@example.com`
  try {
    await page.goto('/')
    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('navigation', { name: '系统设置' }).getByRole('menuitem', { name: 'GitHub 登录' }).click()
    const panel = page.locator('#settings-oauth')
    const github = panel.locator('.oauth-block').filter({ hasText: 'GitHub 登录' })
    await expect(github).toContainText('未配置')

    await github.getByLabel('Client ID').fill(clientId)
    await github.getByLabel('Client Secret').fill(clientSecret)
    await expect(github.getByRole('textbox', { name: '回调地址' })).toHaveValue(redirectUri)
    await github.getByLabel('管理员白名单').fill(allowlist)
    await github.getByRole('button', { name: '保存配置' }).click()
    await expect(page.getByText('OAuth 配置已保存')).toBeVisible()
    await expect(github).toContainText('后台配置')
    await expect(github.getByLabel('Client Secret')).toHaveValue('')

    const storedResponse = await call('/api/settings/oauth')
    expect(storedResponse.ok()).toBeTruthy()
    const storedText = await storedResponse.text()
    expect(storedText).not.toContain(clientSecret)
    const stored = JSON.parse(storedText) as {
      github: { configured: boolean; clientId: string; redirectUri: string; allowlist: string; secretConfigured: boolean; source: string }
    }
    expect(stored.github).toMatchObject({
      configured: true,
      clientId,
      redirectUri,
      allowlist,
      secretConfigured: true,
      source: 'database',
    })

    await page.reload()
    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('navigation', { name: '系统设置' }).getByRole('menuitem', { name: 'GitHub 登录' }).click()
    const reloadedGithub = page.locator('#settings-oauth .oauth-block').filter({ hasText: 'GitHub 登录' })
    await expect(reloadedGithub).toContainText('后台配置')
    await expect(reloadedGithub.getByLabel('Client ID')).toHaveValue(clientId)
    await expect(reloadedGithub.getByLabel('Client Secret')).toHaveValue('')
  } finally {
    await call('/api/settings/oauth?provider=all', { method: 'DELETE' })
  }
})

test('管理端用未保存的表单值测试 SMTP，并校验空密码二次保存', async ({ page }) => {
  const { call, api } = createStackApi(page.request, sessionToken)
  await call('/api/settings/smtp', { method: 'DELETE' })
  const config = { host: '127.0.0.1', port: 1, secure: false, username: 'real-smtp-user', authType: 'plain', from: 'noreply@example.com', fromName: 'Plugmesh E2E' }
  try {
    await page.goto('/')
    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('menuitem', { name: '邮件 SMTP' }).click()
    const panel = page.locator('#settings-smtp')
    await expect(panel).toContainText('未配置')

    // 未保存也能测试：端口 1 必然拒绝连接，失败后保留错误且不放开保存。
    await panel.getByLabel('SMTP Host').fill(config.host)
    await panel.getByLabel('端口').fill(String(config.port))
    await panel.getByLabel('用户名').fill(config.username)
    await panel.getByLabel('密码 / 授权码').fill('real-smtp-secret')
    await panel.getByLabel('发件邮箱').fill(config.from)
    await panel.getByLabel('发件人名称').fill(config.fromName)
    await panel.getByLabel('测试收件邮箱').fill('ops@example.com')
    await panel.getByRole('button', { name: '发送测试邮件' }).click()
    await expect(page.getByText('测试邮件发送失败')).toBeVisible({ timeout: 20_000 })
    await expect(panel.locator('.ant-alert')).toBeVisible()
    await expect(panel.getByRole('button', { name: '保存 SMTP 配置' })).toBeDisabled()

    const audits = (await (await call('/api/audit')).json()) as { results: Array<{ action: string; detail_json: string }> }
    const failed = audits.results.filter((item) => item.action === 'smtp.test.failed')
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0].detail_json).not.toContain('real-smtp-secret')

    // 首存写入密文；二次保存留空密码时沿用已存密钥。
    const first = await api('/api/settings/smtp', { method: 'PUT', data: { ...config, password: 'real-smtp-secret' } })
    expect(await first.json()).toMatchObject({ configured: true, host: '127.0.0.1', port: 1, username: 'real-smtp-user', from: 'noreply@example.com', fromName: 'Plugmesh E2E' })
    const second = await api('/api/settings/smtp', { method: 'PUT', data: { ...config, password: '' } })
    expect(await second.json()).toMatchObject({ configured: true, username: 'real-smtp-user' })
    const stored = (await (await call('/api/settings/smtp')).json()) as Record<string, unknown>
    expect(stored).not.toHaveProperty('password')

    // 重载后配置来自 D1，密码输入框保持为空。
    await page.reload()
    await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
    await page.getByRole('menuitem', { name: '邮件 SMTP' }).click()
    await expect(panel).toContainText('已配置')
    await expect(panel.getByLabel('SMTP Host')).toHaveValue('127.0.0.1')
    await expect(panel.getByLabel('用户名')).toHaveValue('real-smtp-user')
    await expect(panel.getByLabel('密码 / 授权码')).toHaveValue('')
  } finally {
    await call('/api/settings/smtp', { method: 'DELETE' })
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
