import { expect, test, type Page, type Route } from '@playwright/test'

const overview = { onlineServers: 2, enabledPlugins: 3, domains: 1 }

const platformSettings = {
  maintenance: false,
  pluginDomainSuffix: '.plugins.example.com',
  quotas: { requests: 1_000_000, activeConnections: 200, r2Bytes: 1_073_741_824, r2Objects: 1_000, d1Queries: 500_000, kvOperations: 100_000, durableObjectRequests: 500_000 },
}

const oauthSettings = {
  github: { configured: true, clientId: 'mock-github-client', redirectUri: 'https://console.example.test/auth/github/callback', allowlist: 'admin', secretConfigured: true, source: 'environment' },
  cloudflare: { configured: true, clientId: 'mock-cloudflare-client', redirectUri: 'https://console.example.test/auth/cloudflare/callback', scope: 'workers-platform.read workers-platform.write', secretConfigured: true, source: 'environment', responseType: 'code', grantType: 'authorization_code', tokenAuthMethod: 'client_secret_basic', pkce: false },
  sessionSecretConfigured: true,
  updatedAt: null,
  unreadable: false,
}

const localUsage = {
  requestCount: 1_200,
  requestWindowStartedAt: '2026-10-21T00:00:00.000Z',
  activeConnections: 4,
  r2Bytes: 2_048,
  r2Objects: 2,
  updatedAt: '2026-10-21T00:00:00.000Z',
  snapshots: [],
  breakdown: { users: [], plugins: [], domains: [] },
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
  maintenance: boolean
  registrationCodeRequests: number
  domainRequests: { pluginInstanceId: string; prefix: string }[]
  commandRequests: string[]
  oauthUpdates: unknown[]
  platformUpdates: unknown[]
  smtpUpdates: unknown[]
  smtpTests: unknown[]
  smtpTestError: { error: string; field?: string } | null
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
    maintenance: false,
    registrationCodeRequests: 0,
    domainRequests: [],
    commandRequests: [],
    oauthUpdates: [],
    platformUpdates: [],
    smtpUpdates: [],
    smtpTests: [],
    smtpTestError: null,
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
  if (pathname === '/api/settings/oauth') {
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { github?: { clientId: string }; cloudflare?: { clientId: string } }
      state.oauthUpdates.push(body)
      return route.fulfill({ json: {
        ...oauthSettings,
        github: body.github ? { ...oauthSettings.github, clientId: body.github.clientId, source: 'database' } : oauthSettings.github,
        cloudflare: body.cloudflare ? { ...oauthSettings.cloudflare, clientId: body.cloudflare.clientId, source: 'database' } : oauthSettings.cloudflare,
      } })
    }
    return route.fulfill({ json: oauthSettings })
  }
  if (pathname === '/api/settings/smtp') {
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { host: string; port: number; secure: boolean; username: string; authType: string; from: string; fromName: string; replyTo: string }
      state.smtpUpdates.push(body)
      return route.fulfill({ json: { configured: true, host: body.host, port: body.port, secure: body.secure, username: body.username, authType: body.authType, from: body.from, fromName: body.fromName || null, replyTo: body.replyTo || null, updatedAt: '2026-10-21T00:00:00.000Z' } })
    }
    return route.fulfill({ json: { configured: false } })
  }
  if (pathname === '/api/settings/smtp/test' && method === 'POST') {
    if (state.smtpTestError) return route.fulfill({ status: 400, json: state.smtpTestError })
    state.smtpTests.push(route.request().postDataJSON())
    return route.fulfill({ json: { sent: true, attempts: 1 } })
  }
  if (pathname === '/api/settings/platform' && method === 'PUT') {
    const body = route.request().postDataJSON() as typeof platformSettings
    state.platformUpdates.push(body)
    return route.fulfill({ json: { ...platformSettings, ...body, maintenance: state.maintenance } })
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
      return route.fulfill({ json: { ...platformSettings, maintenance: state.maintenance } })
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
  await expect(page.getByText('平台运行中')).toBeVisible()
  await expect(page.getByText(/^官方 Analytics · 未连接$/)).toBeVisible()
  await expect(page.getByText(/^本地计数 · /)).toBeVisible()
  const requestProgress = page.getByRole('progressbar', { name: '平台请求' })
  expect(await requestProgress.evaluate((element) => Number.parseFloat((element.firstElementChild as HTMLElement).style.width))).toBeGreaterThan(0)

  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '平台数据已刷新' })).toBeVisible()
})

test('管理端在后台保存 OAuth 配置且不回显密钥', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('button', { name: 'GitHub 登录' }).click()
  const panel = page.locator('#settings-oauth')
  await expect(panel).toContainText('环境变量回退')
  const callback = panel.getByLabel('回调地址').first()
  await expect(callback).toHaveValue('http://127.0.0.1:4184/auth/github/callback')
  await expect(callback).toHaveAttribute('readonly', '')
  await panel.getByLabel('Client ID').first().fill('mock-github-client-new')
  await panel.getByLabel('Client Secret').first().fill('mock-secret')
  await panel.getByRole('button', { name: '保存配置' }).first().click()
  await expect(page.getByText('OAuth 配置已保存')).toBeVisible()
  expect(worker.oauthUpdates).toEqual([{ github: { clientId: 'mock-github-client-new', clientSecret: 'mock-secret', redirectUri: 'http://127.0.0.1:4184/auth/github/callback', allowlist: 'admin' } }])
  await expect(panel.getByLabel('Client Secret').first()).toHaveValue('')
  await expect(panel).toContainText('后台配置')
})

test('Cloudflare 区块展示协议参数并区分授权诊断', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/?cloudflare_error=access_denied&cloudflare_error_code=access_denied&cloudflare_error_description=User%20denied%20access')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  const panel = page.locator('#settings-cloudflare')
  const protocol = panel.locator('.protocol-facts')
  await expect(protocol).toContainText('response_type')
  await expect(protocol).toContainText('code')
  await expect(protocol).toContainText('authorization_code')
  await expect(protocol).toContainText('client_secret_basic')
  await expect(protocol).toContainText('关闭')
  await expect(panel.getByRole('textbox', { name: '回调地址' })).toHaveValue('http://127.0.0.1:4184/auth/cloudflare/callback')

  const diagnosis = panel.getByTestId('cloudflare-diagnosis')
  await expect(diagnosis).toContainText('授权诊断')
  await expect(diagnosis).toContainText('access_denied')
  await expect(diagnosis).toContainText('User denied access')
  await expect(diagnosis).toContainText('你拒绝了授权请求')
  expect(new URL(page.url()).search).toBe('')
  await diagnosis.getByRole('button', { name: '关闭诊断' }).click()
  await expect(panel.getByTestId('cloudflare-diagnosis')).toHaveCount(0)

  await panel.getByLabel('Client ID').fill('mock-cloudflare-client-new')
  await panel.getByRole('button', { name: '保存配置' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: 'Cloudflare 客户端配置已保存' })).toBeVisible()
  expect(worker.oauthUpdates).toEqual([{ cloudflare: { clientId: 'mock-cloudflare-client-new', clientSecret: '', redirectUri: 'http://127.0.0.1:4184/auth/cloudflare/callback', scope: 'workers-platform.read workers-platform.write' } }])

  await page.goto('/?cloudflare_error=Cloudflare%20%E6%8E%88%E6%9D%83%E5%A4%B1%E8%B4%A5%EF%BC%9Ainvalid_client&cloudflare_error_code=invalid_client')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  const invalidClient = page.locator('#settings-cloudflare').getByTestId('cloudflare-diagnosis')
  await expect(invalidClient).toContainText('invalid_client')
  await expect(invalidClient).toContainText('Client ID 或 Secret')
  await expect(invalidClient).not.toContainText('你拒绝了授权请求')
})

test('管理端测试 SMTP 通过后才能保存并清空密码', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('button', { name: '邮件 SMTP' }).click()
  const panel = page.locator('#settings-smtp')

  await panel.getByLabel('SMTP Host').fill('smtp.example.test')
  await panel.getByLabel('用户名').fill('mailer')
  await panel.getByLabel('密码 / 授权码').fill('mock-smtp-secret')
  await panel.getByLabel('发件邮箱').fill('noreply@example.test')
  const save = panel.getByRole('button', { name: '保存 SMTP 配置' })
  await expect(save).toBeDisabled()
  await expect(panel).toContainText('先测试连接')

  await panel.getByLabel('测试收件邮箱').fill('ops@example.test')
  await panel.getByRole('button', { name: '发送测试邮件' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '测试邮件已发送' })).toBeVisible()
  await expect(save).toBeEnabled()

  await save.click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: 'SMTP 配置已保存' })).toBeVisible()
  expect(worker.smtpTests).toEqual([{ to: 'ops@example.test', settings: { host: 'smtp.example.test', port: 587, secure: false, username: 'mailer', password: 'mock-smtp-secret', authType: 'plain', from: 'noreply@example.test', fromName: '', replyTo: '' } }])
  expect(worker.smtpUpdates).toEqual([{ host: 'smtp.example.test', port: 587, secure: false, username: 'mailer', password: 'mock-smtp-secret', authType: 'plain', from: 'noreply@example.test', fromName: '', replyTo: '' }])
  await expect(panel.getByLabel('密码 / 授权码')).toHaveValue('')
  await expect(panel).toContainText('已配置')
})

test('管理端 SMTP 测试失败保留错误且不能保存', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.smtpTestError = { error: 'SMTP host is invalid', field: 'host' }
  await page.goto('/')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('button', { name: '邮件 SMTP' }).click()
  const panel = page.locator('#settings-smtp')

  await panel.getByLabel('SMTP Host').fill('bad host')
  await panel.getByLabel('用户名').fill('mailer')
  await panel.getByLabel('密码 / 授权码').fill('mock-smtp-secret')
  await panel.getByLabel('发件邮箱').fill('noreply@example.test')
  await panel.getByLabel('测试收件邮箱').fill('ops@example.test')
  await panel.getByRole('button', { name: '发送测试邮件' }).click()

  await expect(panel.locator('.ant-alert')).toContainText('SMTP Host 填写有误')
  await expect(panel.getByRole('button', { name: '保存 SMTP 配置' })).toBeDisabled()
  expect(worker.smtpUpdates).toHaveLength(0)
})

test('管理端在后台保存插件域名后缀', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('button', { name: '维护、域名与配额' }).click()
  const panel = page.locator('#settings-maintenance')
  await expect(panel.getByLabel('插件域名后缀')).toHaveValue('.plugins.example.com')
  await panel.getByLabel('插件域名后缀').fill('plugins.example.net')
  await panel.getByRole('button', { name: '保存域名后缀' }).click()
  await expect(page.getByText('插件域名后缀已保存')).toBeVisible()
  expect(worker.platformUpdates).toHaveLength(1)
  expect(worker.platformUpdates[0]).toMatchObject({ pluginDomainSuffix: 'plugins.example.net' })
})

test('管理端总览显示平台维护状态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.maintenance = true
  await page.goto('/')

  await expect(page.getByText('平台维护中')).toBeVisible()
})

test('管理端总览展示连接异常', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.servers = [
    { id: 'server-offline', name: '离线节点', status: 'offline', last_seen_at: '2026-10-21T01:00:00.000Z', created_at: '2026-10-20T00:00:00.000Z' },
    { id: 'server-online', name: '在线节点', status: 'online', last_seen_at: '2026-10-21T02:00:00.000Z', created_at: '2026-10-20T00:00:00.000Z' },
  ]
  await page.goto('/')

  await expect(page.getByText('离线节点')).toBeVisible()
  await expect(page.getByText('离线', { exact: true })).toBeVisible()
  await expect(page.getByText('在线节点')).toHaveCount(0)
  await expect(page.getByText('暂无错误摘要')).toBeHidden()
})

test('管理端总览展示最近错误并可跳转访问日志', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.accessLogs = [
    { id: 'log-1', hostname: 'demo.plugins.example.com', method: 'GET', path: '/boom', status: 502, duration_ms: 31, error: 'upstream_failed', created_at: '2026-10-21T01:02:03.000Z' },
    { id: 'log-2', hostname: 'demo.plugins.example.com', method: 'POST', path: '/crash', status: 500, duration_ms: 12, error: null, created_at: '2026-10-21T01:01:02.000Z' },
    { id: 'log-3', hostname: 'api.plugins.example.com', method: 'GET', path: '/timeout', status: 504, duration_ms: 900, error: 'timeout', created_at: '2026-10-21T01:00:01.000Z' },
    { id: 'log-4', hostname: 'api.plugins.example.com', method: 'GET', path: '/missing', status: 404, duration_ms: 8, error: null, created_at: '2026-10-21T00:59:00.000Z' },
  ]
  await page.goto('/')

  await expect(page.getByText('正在读取错误摘要')).toBeVisible()
  worker.releaseLogs()

  await expect(page.getByText('demo.plugins.example.com/boom')).toBeVisible()
  await expect(page.getByText('GET · upstream_failed')).toBeVisible()
  await expect(page.getByText('未记录错误类型')).toBeVisible()
  await expect(page.locator('.activity-item')).toHaveCount(3)
  await expect(page.getByText('/missing')).toHaveCount(0)

  await page.getByRole('button', { name: '查看访问日志' }).click()
  await expect(page.getByRole('heading', { name: '访问日志', level: 1 })).toBeVisible()
  await expect(page.getByText('/missing')).toBeVisible()
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
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '平台数据已刷新' })).toBeVisible()
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
  await dialog.getByRole('combobox').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '示例插件' }).click()
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
  await dialog.getByRole('combobox').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '示例插件' }).click()
  await dialog.getByLabel('域名前缀').fill('Bad Prefix')
  await dialog.getByRole('button', { name: '分配域名' }).click()

  await expect(dialog.getByText('域名前缀仅允许小写字母、数字和连字符')).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '分配域名' })).toBeEnabled()
  expect(worker.domainRequests).toEqual([{ pluginInstanceId: 'plugin-1', prefix: 'Bad Prefix' }])
})

test('管理端把英文服务端错误替换为本地化提示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.plugins = [enabledPlugin]
  worker.domainError = 'Domain prefix is invalid'
  await page.goto('/')
  await page.getByRole('button', { name: '公开域名', exact: true }).click()
  await page.getByRole('button', { name: '分配域名' }).click()

  const dialog = page.getByRole('dialog', { name: '分配公开域名' })
  await dialog.getByRole('combobox').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '示例插件' }).click()
  await dialog.getByLabel('域名前缀').fill('Bad Prefix')
  await dialog.getByRole('button', { name: '分配域名' }).click()

  await expect(dialog.getByText('请求失败，请稍后重试', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Domain prefix is invalid')).toHaveCount(0)
})

test('管理端从发现态插件提交加载命令', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.plugins = [{ ...enabledPlugin, state: 'discovered', desired_state: 'loaded' }]
  await page.goto('/')
  await page.getByRole('button', { name: '插件实例', exact: true }).click()
  await page.locator('.header-actions').getByRole('button', { name: '加载插件' }).click()

  const dialog = page.getByRole('dialog', { name: '加载插件' })
  await dialog.getByRole('combobox').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '示例插件' }).click()
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
