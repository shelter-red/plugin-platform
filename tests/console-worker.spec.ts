import { expect, test, type Page, type Route } from '@playwright/test'

const overview = { onlineServers: 2, enabledPlugins: 3, domains: 1 }

const platformSettings = {
  maintenance: false,
  quotas: { requests: 1_000_000, activeConnections: 200, r2Bytes: 1_073_741_824, r2Objects: 1_000, d1Queries: 500_000, kvOperations: 100_000, durableObjectRequests: 500_000 },
}

const localUsage = {
  requestCount: 1_200,
  requestWindowStartedAt: '2026-10-21T00:00:00.000Z',
  activeConnections: 4,
  r2Bytes: 2_048,
  r2Objects: 2,
  updatedAt: '2026-10-21T00:00:00.000Z',
  snapshots: [],
}

type WorkerMock = {
  failData: boolean
  releaseLogs: () => void
  servers: unknown[]
  plugins: unknown[]
  domains: unknown[]
  audits: unknown[]
  accessLogs: unknown[]
  snapshots: unknown[]
  domainError: string | null
  registrationCodeRequests: number
  domainRequests: { pluginInstanceId: string; prefix: string }[]
  commandRequests: string[]
}

async function mockWorker(page: Page): Promise<WorkerMock> {
  let releaseLogs = () => {}
  const logsGate = new Promise<void>((resolve) => { releaseLogs = resolve })
  const state: WorkerMock = {
    failData: false,
    releaseLogs: () => releaseLogs(),
    servers: [],
    plugins: [],
    domains: [],
    audits: [],
    accessLogs: [],
    snapshots: [],
    domainError: null,
    registrationCodeRequests: 0,
    domainRequests: [],
    commandRequests: [],
  }

  await page.route('**/api/**', (route) => handleApi(route, state, logsGate))
  return state
}

async function handleApi(route: Route, state: WorkerMock, logsGate: Promise<void>): Promise<void> {
  const { pathname } = new URL(route.request().url())
  const method = route.request().method()
  if (method === 'POST' && pathname === '/api/registration-codes') {
    state.registrationCodeRequests += 1
    return route.fulfill({ status: 201, json: { code: 'PLUG-TEST-0001', expiresAt: '2026-10-21T00:10:00.000Z' } })
  }
  if (method === 'POST' && pathname === '/api/domains') {
    const body = route.request().postDataJSON() as { pluginInstanceId: string; prefix: string }
    state.domainRequests.push(body)
    if (state.domainError) return route.fulfill({ status: 400, json: { error: state.domainError } })
    return route.fulfill({ status: 201, json: { hostname: `${body.prefix}.plugins.example.com`, status: 'online' } })
  }
  const command = pathname.match(/^\/api\/plugins\/([^/]+)\/(load|unload|enable|disable|reload)$/)
  if (method === 'POST' && command) {
    const id = decodeURIComponent(command[1])
    state.commandRequests.push(`${id}:${command[2]}`)
    return route.fulfill({ json: { id, state: command[2] === 'load' ? 'loaded' : 'enabled', accepted: true } })
  }
  const serverDetail = pathname.match(/^\/api\/servers\/([^/]+)$/)
  if (method === 'GET' && serverDetail) {
    const id = decodeURIComponent(serverDetail[1])
    const server = (state.servers as { id: string }[]).find((item) => item.id === id)
    if (!server) return route.fulfill({ status: 404, json: { error: 'server not found' } })
    return route.fulfill({ json: { server, plugins: state.plugins, recentErrors: state.accessLogs } })
  }
  const pluginDetail = pathname.match(/^\/api\/plugins\/([^/]+)$/)
  if (method === 'GET' && pluginDetail) {
    const id = decodeURIComponent(pluginDetail[1])
    const plugin = (state.plugins as { id: string }[]).find((item) => item.id === id)
    if (!plugin) return route.fulfill({ status: 404, json: { error: 'plugin not found' } })
    return route.fulfill({ json: { plugin: { ...plugin, created_at: '2026-10-21T00:00:00.000Z', server_status: 'online', domain_id: 'domain-1', domain_status: 'online' }, recentErrors: [] } })
  }
  if (pathname === '/api/access-logs') {
    await logsGate
    return route.fulfill({ json: { results: state.accessLogs, errorCount: 0, since: '2026-09-21T00:00:00.000Z' } })
  }
  if (state.failData && ['/api/servers', '/api/plugins', '/api/domains'].includes(pathname)) {
    return route.fulfill({ status: 500, json: { error: 'smoke failure' } })
  }
  switch (pathname) {
    case '/api/overview':
      return route.fulfill({ json: overview })
    case '/api/servers':
      return route.fulfill({ json: { results: state.servers } })
    case '/api/audit':
      return route.fulfill({ json: { results: state.audits } })
    case '/api/plugins':
      return route.fulfill({ json: { results: state.plugins } })
    case '/api/domains':
      return route.fulfill({ json: { results: state.domains } })
    case '/api/usage/cloudflare':
      return route.fulfill({ json: { configured: false } })
    case '/api/usage/local':
      return route.fulfill({ json: { ...localUsage, snapshots: state.snapshots } })
    case '/api/settings/platform':
      return route.fulfill({ json: platformSettings })
    case '/api/settings/cloudflare':
      return route.fulfill({ json: { configured: false, accountIdConfigured: false, accountId: null, updatedAt: null } })
    case '/api/settings/smtp':
      return route.fulfill({ json: { configured: false } })
    default:
      return route.fulfill({ status: 404, json: { error: 'unexpected smoke path' } })
  }
}

test('管理端显示 Worker 实时数据并在刷新后提示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockWorker(page)
  await page.goto('/')

  await expect(page.getByText('Worker 数据已连接')).toBeVisible()
  await expect(page.locator('.metric-card', { hasText: '在线服务器' }).locator('.metric-number')).toHaveText(/^2/)
  await expect(page.locator('.metric-card', { hasText: '已启用插件' }).locator('.metric-number')).toHaveText(/^3/)
  await expect(page.locator('.metric-card', { hasText: '公开域名' }).locator('.metric-number')).toHaveText(/^1/)

  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.locator('.toast')).toHaveText('平台数据已刷新')
})

test('管理端访问日志先显示加载态再回到空态', async ({ page }) => {
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '访问日志', exact: true }).click()

  await expect(page.getByText('正在读取访问日志')).toBeVisible()
  worker.releaseLogs()
  await expect(page.getByText('暂无访问日志')).toBeVisible()
})

test('管理端数据读取失败时显示错误并可重试恢复', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.failData = true
  await page.goto('/')

  await expect(page.getByText('数据读取失败')).toBeVisible()
  await expect(page.getByText('Worker 数据已连接')).toBeVisible()

  worker.failData = false
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('数据读取失败')).toBeHidden()
  await expect(page.locator('.toast')).toHaveText('平台数据已刷新')
})

test('管理端设置页显示 Worker 维护状态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockWorker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()

  await expect(page.getByText('运行中')).toBeVisible()
  await expect(page.getByText('允许新连接')).toBeVisible()
})

const enabledPlugin = {
  id: 'plugin-1',
  plugin_id: 'demo',
  name: '示例插件',
  version: '1.0.0',
  state: 'enabled',
  desired_state: 'enabled',
  server_id: 'server-1',
  server_name: '本地开发服务器',
  domain_hostname: null,
  manifest_json: '{}',
  updated_at: '2026-10-21T00:00:00.000Z',
}

test('管理端生成一次性注册码并在弹窗中保留展示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '插件服务器', exact: true }).click()

  await page.getByRole('button', { name: '绑定服务器' }).click()
  const dialog = page.getByRole('dialog', { name: '绑定插件服务器' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '生成注册码' }).click()

  await expect(dialog.getByText('PLUG-TEST-0001')).toBeVisible()
  await expect(dialog.getByText(/注册码有效至/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: '生成注册码' })).toBeHidden()
  expect(worker.registrationCodeRequests).toBe(1)
})

test('管理端分配域名时先校验前缀再提交并展示结果', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.plugins = [enabledPlugin]
  await page.goto('/')
  await page.getByRole('button', { name: '公开域名', exact: true }).click()
  await page.getByRole('button', { name: '分配域名' }).click()

  const dialog = page.getByRole('dialog', { name: '分配公开域名' })
  await dialog.getByRole('combobox').selectOption('plugin-1')
  const prefix = dialog.getByLabel('域名前缀')
  await expect(prefix).toHaveAttribute('maxlength', '48')
  await dialog.getByRole('button', { name: '分配域名' }).click()
  await expect(dialog.getByText('请输入域名前缀')).toBeVisible()
  expect(worker.domainRequests).toEqual([])

  await prefix.fill('demo')
  await dialog.getByRole('button', { name: '分配域名' }).click()
  await expect(dialog.getByText('公开域名已分配')).toBeVisible()
  await expect(dialog.getByText('demo.plugins.example.com')).toBeVisible()
  expect(worker.domainRequests).toEqual([{ pluginInstanceId: 'plugin-1', prefix: 'demo' }])
})

test('管理端域名分配失败时在弹窗内显示服务端校验错误', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.plugins = [enabledPlugin]
  worker.domainError = '域名前缀仅允许小写字母、数字和连字符'
  await page.goto('/')
  await page.getByRole('button', { name: '公开域名', exact: true }).click()
  await page.getByRole('button', { name: '分配域名' }).click()

  const dialog = page.getByRole('dialog', { name: '分配公开域名' })
  await dialog.getByRole('combobox').selectOption('plugin-1')
  await dialog.getByLabel('域名前缀').fill('Bad Prefix')
  await dialog.getByRole('button', { name: '分配域名' }).click()

  await expect(dialog.getByText('域名前缀仅允许小写字母、数字和连字符')).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '分配域名' })).toBeEnabled()
  expect(worker.domainRequests).toEqual([{ pluginInstanceId: 'plugin-1', prefix: 'Bad Prefix' }])
})

test('管理端从发现态插件提交加载命令', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.plugins = [{ ...enabledPlugin, state: 'discovered', desired_state: 'loaded' }]
  await page.goto('/')
  await page.getByRole('button', { name: '插件实例', exact: true }).click()
  await page.locator('.header-actions').getByRole('button', { name: '加载插件' }).click()

  const dialog = page.getByRole('dialog', { name: '加载插件' })
  await dialog.getByRole('combobox').selectOption('plugin-1')
  await dialog.getByRole('button', { name: '加载插件' }).click()

  await expect(dialog.getByText('加载命令已确认')).toBeVisible()
  await expect(dialog.getByText('插件当前状态：loaded')).toBeVisible()
  expect(worker.commandRequests).toEqual(['plugin-1:load'])
})

const onlineServer = { id: 'server-1', name: '本地开发服务器', status: 'online', last_seen_at: '2026-10-21T09:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z' }
const onlineDomain = { id: 'domain-1', hostname: 'demo.plugins.example.com', status: 'online', plugin_instance_id: 'plugin-1', plugin_name: '示例插件', created_at: '2026-10-02T00:00:00.000Z' }
const auditEntry = { id: 'audit-1', action: 'plugin.load', detail_json: '{"plugin":"demo"}', created_at: '2026-10-21T08:00:00.000Z', actor_name: '管理员', actor_email: 'admin@example.com' }
const accessLogEntry = { id: 'log-1', hostname: 'demo.plugins.example.com', method: 'GET', path: '/', status: 200, duration_ms: 18, error: null, created_at: '2026-10-21T08:30:00.000Z' }
const trendSnapshots = [
  { captured_at: '2026-10-19T00:00:00.000Z', request_count: 300, active_connections: 2, r2_bytes: 0, r2_objects: 0 },
  { captured_at: '2026-10-20T00:00:00.000Z', request_count: 600, active_connections: 3, r2_bytes: 0, r2_objects: 0 },
  { captured_at: '2026-10-21T00:00:00.000Z', request_count: 1200, active_connections: 4, r2_bytes: 2048, r2_objects: 2 },
]

test('管理端窄窗口下表格、图表和详情弹窗可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const worker = await mockWorker(page)
  worker.servers = [onlineServer]
  worker.plugins = [enabledPlugin]
  worker.domains = [onlineDomain]
  worker.audits = [auditEntry]
  worker.accessLogs = [accessLogEntry]
  worker.snapshots = trendSnapshots
  await page.goto('/')
  worker.releaseLogs()

  await expect(page.getByRole('img', { name: '7d 平台请求计数趋势' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()

  const pages = [
    { nav: '插件服务器', row: '本地开发服务器' },
    { nav: '插件实例', row: '示例插件' },
    { nav: '公开域名', row: 'demo.plugins.example.com' },
    { nav: '访问日志', row: 'demo.plugins.example.com' },
    { nav: '审计日志', row: '加载插件' },
  ]
  for (const entry of pages) {
    await page.getByRole('button', { name: '打开导航' }).click()
    await page.getByRole('button', { name: entry.nav, exact: true }).click()
    await expect(page.getByText(entry.row).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  }

  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '插件实例', exact: true }).click()
  await page.getByRole('button', { name: '查看 示例插件 详情' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(390)
  await expect(dialog.getByText('暂无 500 以上访问错误。').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
