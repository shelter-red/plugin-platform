import { expect, test, type Page, type Route } from '@playwright/test'

const overview = { onlineServers: 2, enabledPlugins: 3, domains: 1 }

const defaultWorkspace = { id: 'ws_default', name: '默认工作区', slug: 'default', role: 'owner', created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' }

const platformSettings = {
  maintenance: false,
  pluginDomainSuffix: '.plugins.example.com',
  quotas: { activeConnections: 200, r2Bytes: 1_073_741_824, r2Objects: 1_000 },
}

const cloudflareSettings = {
  configured: false,
  credentialKind: null,
  accountIdConfigured: false,
  accountId: null,
  email: null,
  updatedAt: null,
  lastVerifiedAt: null,
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

const cloudflareFreeUsage = {
  configured: true,
  accountIdConfigured: true,
  cached: false,
  updatedAt: '2026-10-21T00:00:00.000Z',
  period: { start: '2026-10-21T00:00:00.000Z', end: '2026-10-22T00:00:00.000Z' },
  requests: 50_000,
  d1: { readQueries: 2_000, writeQueries: 500, rowsRead: 1_250_000, rowsWritten: 50_000 },
  kv: { read: 50_000, write: 500, delete: 200, list: 100 },
  durableObjects: { requests: 25_000, cpuTime: 10, storedBytes: 2_048 },
  plan: { id: 'free', name: 'Free', free: true, confirmed: true },
  limitSource: 'cloudflare_subscriptions_free_baseline',
  limits: {
    workerRequests: 100_000,
    d1RowsRead: 5_000_000,
    d1RowsWritten: 100_000,
    kvRead: 100_000,
    kvWrite: 1_000,
    kvDelete: 1_000,
    kvList: 1_000,
    doRequests: 100_000,
  },
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
  syncRequests: string[]
  workspaces: { id: string; name: string; slug: string; role: string; created_at: string; updated_at: string }[]
  workspaceMembers: { user_id: string; display_name: string | null; email: string | null; role: string; created_at: string }[]
  workspaceRequests: string[]
  passwordUpdates: unknown[]
  platformUpdates: unknown[]
  smtpUpdates: unknown[]
  smtpTests: unknown[]
  smtpTestError: { error: string; field?: string } | null
  cloudflareUpdates: unknown[]
  cloudflareUpdateError: { status: number; code: string; message: string } | null
  cloudflareSettings: typeof cloudflareSettings
  usage: Record<string, unknown>
  usageFault: { status: number; code: string; message: string } | null
  cloudflareUsageRequests: number
  localUsageRequests: number
  holdNextCloudflareUsage: boolean
  releaseCloudflareUsage: () => void
}

async function mockWorker(page: Page): Promise<WorkerMock> {
  let releaseLogs = () => {}
  let releaseUsageRequest = () => {}
  const logsGate = new Promise<void>((resolve) => { releaseLogs = resolve })
  const usageGate = new Promise<void>((resolve) => { releaseUsageRequest = resolve })
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
    syncRequests: [],
    workspaces: [{ ...defaultWorkspace }],
    workspaceMembers: [{ user_id: 'user-1', display_name: 'E2E Admin', email: 'e2e@example.com', role: 'owner', created_at: '2026-09-01T00:00:00.000Z' }],
    workspaceRequests: [],
    passwordUpdates: [],
    platformUpdates: [],
    smtpUpdates: [],
    smtpTests: [],
    smtpTestError: null,
    cloudflareUpdates: [],
    cloudflareUpdateError: null,
    cloudflareSettings: { ...cloudflareSettings },
    usage: { configured: false, cached: false },
    usageFault: null,
    cloudflareUsageRequests: 0,
    localUsageRequests: 0,
    holdNextCloudflareUsage: false,
    releaseCloudflareUsage: () => releaseUsageRequest(),
  }

  await page.route('**/api/**', (route) => handleApi(route, state, logsGate, usageGate))
  return state
}

async function handleApi(route: Route, state: WorkerMock, logsGate: Promise<void>, usageGate: Promise<void>): Promise<void> {
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
  const sync = pathname.match(/^\/api\/servers\/([^/]+)\/sync$/)
  if (method === 'POST' && sync) {
    state.syncRequests.push(decodeURIComponent(sync[1]))
    return route.fulfill({ json: { accepted: true } })
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
  if (pathname === '/api/settings/password' && method === 'PUT') {
    state.passwordUpdates.push(route.request().postDataJSON())
    return route.fulfill({ status: 204, body: '' })
  }
  if (pathname === '/api/settings/cloudflare') {
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { email: string; globalApiKey: string; accountId?: string }
      state.cloudflareUpdates.push(body)
      if (state.cloudflareUpdateError) {
        const { status, ...error } = state.cloudflareUpdateError
        return route.fulfill({ status, json: error })
      }
      state.cloudflareSettings = {
        ...cloudflareSettings,
        configured: true,
        credentialKind: 'global_api_key',
        accountIdConfigured: true,
        accountId: '0123...cdef',
        email: body.email,
        updatedAt: '2026-10-21T00:00:00.000Z',
        lastVerifiedAt: '2026-10-21T00:00:00.000Z',
      }
      return route.fulfill({ json: state.cloudflareSettings })
    }
    if (method === 'DELETE') {
      state.cloudflareSettings = { ...cloudflareSettings }
      return route.fulfill({ json: state.cloudflareSettings })
    }
    return route.fulfill({ json: state.cloudflareSettings })
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
  const memberAction = pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/([^/]+)$/)
  if (memberAction) {
    const userId = decodeURIComponent(memberAction[2])
    state.workspaceRequests.push(`${method} ${pathname}`)
    if (method === 'DELETE') {
      state.workspaceMembers = state.workspaceMembers.filter((member) => member.user_id !== userId)
      return route.fulfill({ json: { deleted: true } })
    }
    const body = route.request().postDataJSON() as { role: string }
    state.workspaceMembers = state.workspaceMembers.map((member) => member.user_id === userId ? { ...member, role: body.role } : member)
    return route.fulfill({ json: { updated: true } })
  }
  const members = pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/)
  if (members) {
    state.workspaceRequests.push(`${method} ${pathname}`)
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { email?: string; userId?: string; role: string }
      const email = body.email ?? null
      state.workspaceMembers.push({ user_id: `user-${state.workspaceMembers.length + 1}`, display_name: email, email, role: body.role, created_at: '2026-10-22T00:00:00.000Z' })
      return route.fulfill({ status: 201, json: { added: true } })
    }
    return route.fulfill({ json: { results: state.workspaceMembers } })
  }
  const workspaceAction = pathname.match(/^\/api\/workspaces\/([^/]+)$/)
  if (workspaceAction) {
    const id = decodeURIComponent(workspaceAction[1])
    state.workspaceRequests.push(`${method} ${pathname}`)
    if (method === 'DELETE') {
      if (id === 'ws_default') return route.fulfill({ status: 409, json: { error: 'The default workspace cannot be deleted' } })
      state.workspaces = state.workspaces.filter((workspace) => workspace.id !== id)
      return route.fulfill({ json: { id, deleted: true } })
    }
    const body = route.request().postDataJSON() as { name: string }
    state.workspaces = state.workspaces.map((workspace) => workspace.id === id ? { ...workspace, name: body.name } : workspace)
    return route.fulfill({ json: state.workspaces.find((workspace) => workspace.id === id) })
  }
  if (pathname === '/api/workspaces') {
    state.workspaceRequests.push(`${method} ${pathname}`)
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { name: string }
      const created = { id: `ws_${state.workspaces.length}`, name: body.name, slug: `workspace-${state.workspaces.length}`, role: 'owner', created_at: '2026-10-22T00:00:00.000Z', updated_at: '2026-10-22T00:00:00.000Z' }
      state.workspaces.push(created)
      return route.fulfill({ status: 201, json: created })
    }
    return route.fulfill({ json: { results: state.workspaces } })
  }
  if (state.failData && ['/api/servers', '/api/plugins', '/api/domains'].includes(pathname)) {
    return route.fulfill({ status: 500, json: { error: 'smoke failure' } })
  }
  switch (pathname) {
    case '/api/me':
      return route.fulfill({ json: { user: { id: 'user-1', display_name: 'E2E Admin', email: 'e2e@example.com', role: 'super_admin' }, workspaces: state.workspaces, activeWorkspaceId: state.workspaces[0]?.id ?? null } })
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
      state.cloudflareUsageRequests += 1
      if (state.holdNextCloudflareUsage) {
        state.holdNextCloudflareUsage = false
        await usageGate
      }
      if (state.usageFault) {
        const { status, ...body } = state.usageFault
        return route.fulfill({ status, json: body })
      }
      return route.fulfill({ json: state.usage })
    case '/api/usage/local':
      state.localUsageRequests += 1
      return route.fulfill({ json: { ...localUsage, snapshots: state.snapshots } })
    case '/api/settings/platform':
      return route.fulfill({ json: { ...platformSettings, maintenance: state.maintenance } })
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
  // 平台请求只计数不设上限，进度条挂在有上限的「活跃连接」上。
  const requestProgress = page.getByRole('progressbar', { name: '活跃连接' })
  expect(await requestProgress.evaluate((element) => Number.parseFloat((element.firstElementChild as HTMLElement).style.width))).toBeGreaterThan(0)

  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '平台数据已刷新' })).toBeVisible()
})

test('默认工作区与带图标控件保持对齐且不遮挡文字', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockWorker(page)
  await page.goto('/')

  await expect(page.locator('.workspace-switcher')).toContainText('默认工作区')
  const layout = await page.evaluate(() => {
    const center = (box: DOMRect) => box.top + box.height / 2
    const workspace = document.querySelector<HTMLElement>('.workspace-switcher')
    const copy = workspace?.querySelector<HTMLElement>('.workspace-copy')
    const icon = workspace?.querySelector<HTMLElement>('.workspace-icon')
    const workspaceBox = workspace?.getBoundingClientRect()
    const copyBox = copy?.getBoundingClientRect()
    const iconBox = icon?.getBoundingClientRect()
    const buttonDeltas = [...document.querySelectorAll<HTMLElement>('button.ant-btn')]
      .filter((button) => button.getBoundingClientRect().height > 0)
      .map((button) => {
        const buttonIcon = button.querySelector<HTMLElement>('.ant-btn-icon')
        if (!buttonIcon) return null
        return Math.abs(center(buttonIcon.getBoundingClientRect()) - center(button.getBoundingClientRect()))
      })
      .filter((delta): delta is number => delta !== null)
    const navDeltas = [...document.querySelectorAll<HTMLElement>('.nav-menu .ant-menu-item')]
      .map((item) => {
        const itemIcon = item.querySelector<HTMLElement>('.ant-menu-item-icon')
        if (!itemIcon) return null
        return Math.abs(center(itemIcon.getBoundingClientRect()) - center(item.getBoundingClientRect()))
      })
      .filter((delta): delta is number => delta !== null)
    return {
      workspaceHeight: workspaceBox?.height ?? 0,
      copyTopGap: (copyBox?.top ?? 0) - (workspaceBox?.top ?? 0),
      copyBottomGap: (workspaceBox?.bottom ?? 0) - (copyBox?.bottom ?? 0),
      workspaceCenterDelta: Math.abs(center(iconBox!) - center(copyBox!)),
      maxButtonDelta: Math.max(...buttonDeltas),
      maxNavDelta: Math.max(...navDeltas),
    }
  })

  expect(layout.workspaceHeight).toBeGreaterThanOrEqual(44)
  expect(layout.copyTopGap).toBeGreaterThan(0)
  expect(layout.copyBottomGap).toBeGreaterThan(0)
  expect(layout.workspaceCenterDelta).toBeLessThan(1)
  expect(layout.maxButtonDelta).toBeLessThan(1)
  expect(layout.maxNavDelta).toBeLessThan(1)
})

test('管理员可以修改密码且页面只保留密码登录设置', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'GitHub 登录' })).toHaveCount(0)
  await page.getByRole('navigation', { name: '系统设置' }).getByRole('menuitem', { name: '管理员密码' }).click()
  const panel = page.locator('#settings-password')
  await panel.getByLabel('当前密码').fill('correct-horse-battery')
  await panel.getByLabel('新密码', { exact: true }).fill('new-correct-horse-battery')
  await panel.getByLabel('确认新密码', { exact: true }).fill('new-correct-horse-battery')
  await panel.getByRole('button', { name: '修改密码' }).click()
  await expect.poll(() => worker.passwordUpdates).toEqual([{ currentPassword: 'correct-horse-battery', newPassword: 'new-correct-horse-battery', confirmPassword: 'new-correct-horse-battery' }])
})

test('Cloudflare 使用 Email 和 Global API Key', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await page.getByRole('navigation', { name: '系统设置' }).getByRole('menuitem', { name: 'Cloudflare' }).click()
  const panel = page.locator('#settings-cloudflare')
  await expect(panel).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/settings')

  // Cloudflare 凭据区只保留 Email、Global API Key 和 Account ID。
  await expect(panel.getByText('响应类型（response_type）')).toHaveCount(0)
  await expect(panel.getByText('PKCE')).toHaveCount(0)
  await expect(panel.getByText('Client ID')).toHaveCount(0)
  await expect(panel.getByText('Client Secret')).toHaveCount(0)
  await expect(panel.getByRole('textbox', { name: '回调地址' })).toHaveCount(0)
  await expect(panel.getByRole('textbox', { name: '授权范围' })).toHaveCount(0)

  await expect(panel.getByTestId('cloudflare-permissions')).toHaveCount(0)
  await expect(panel.getByRole('link', { name: /打开 Cloudflare API Keys/ })).toHaveAttribute('href', 'https://dash.cloudflare.com/profile/api-tokens')
  await panel.getByLabel('Cloudflare Email').fill('admin@example.com')
  await panel.getByLabel('Global API Key').fill('mock-global-api-key')
  await panel.getByLabel('Account ID（可选）').fill('0123456789abcdef0123456789abcdef')
  await panel.getByRole('button', { name: '验证并保存' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: 'Cloudflare 凭据已验证并保存' })).toBeVisible()
  expect(worker.cloudflareUpdates).toEqual([{ email: 'admin@example.com', globalApiKey: 'mock-global-api-key', accountId: '0123456789abcdef0123456789abcdef' }])
  await expect(panel.getByLabel('Global API Key')).toHaveValue('')
  await expect(panel).toContainText('0123...cdef')
  await expect(panel).toContainText('最后验证')
})

test('Cloudflare 凭据被拒绝时保留错误码并停留在设置页', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.cloudflareUpdateError = { status: 403, code: 'credential_denied', message: 'Cloudflare credential cannot access this resource' }
  await page.goto('/settings')
  const panel = page.locator('#settings-cloudflare')
  await expect(panel).toBeVisible()
  await panel.getByLabel('Cloudflare Email').fill('admin@example.com')
  await panel.getByLabel('Global API Key').fill('mock-global-api-key')
  await panel.getByRole('button', { name: '验证并保存' }).click()
  const failure = panel.getByRole('alert').filter({ hasText: 'Cloudflare credential cannot access this resource' })
  await expect(failure).toBeVisible()
  await expect(failure).toContainText('credential_denied')
  expect(new URL(page.url()).pathname).toBe('/settings')
})

test('用量自动加载期间刷新按钮可用，并重新请求官方与本地数据', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.usage = cloudflareFreeUsage
  worker.holdNextCloudflareUsage = true
  await page.goto('/usage')

  const refresh = page.getByTestId('usage-refresh')
  await expect(page.getByText('正在读取官方数据')).toBeVisible()
  await expect(refresh).toBeEnabled()
  await expect.poll(() => worker.cloudflareUsageRequests).toBe(1)
  await expect.poll(() => worker.localUsageRequests).toBe(1)

  await refresh.click()
  await expect.poll(() => worker.cloudflareUsageRequests).toBe(2)
  await expect.poll(() => worker.localUsageRequests).toBe(2)
  worker.releaseCloudflareUsage()
  await expect(page.getByText('Cloudflare Analytics 已连接')).toBeVisible()
})

test('用量页只保留一个刷新入口', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/usage')

  await expect(page.getByTestId('usage-refresh')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '刷新用量' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '去配置' })).toHaveCount(1)

  worker.usage = cloudflareFreeUsage
  await page.goto('/usage')
  await expect(page.getByText('Cloudflare Analytics 已连接')).toBeVisible()
  await expect(page.getByRole('button', { name: '去配置' })).toHaveCount(0)
})

test('Cloudflare 免费额度显示八项已用量、上限和百分比', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.usage = cloudflareFreeUsage
  await page.goto('/usage')

  const section = page.locator('.usage-section').filter({ hasText: 'Cloudflare 免费额度（每日）' })
  await expect(section.locator('.resource-card')).toHaveCount(8)
  const expected = [
    ['Worker 请求', '50,000', '100,000', '已用 50%'],
    ['D1 行读取', '1,250,000', '5,000,000', '已用 25%'],
    ['D1 行写入', '50,000', '100,000', '已用 50%'],
    ['KV 读取', '50,000', '100,000', '已用 50%'],
    ['KV 写入', '500', '1,000', '已用 50%'],
    ['KV 删除', '200', '1,000', '已用 20%'],
    ['KV 列举', '100', '1,000', '已用 10%'],
    ['Durable Object 请求', '25,000', '100,000', '已用 25%'],
  ] as const
  for (const [title, current, limit, percent] of expected) {
    const card = section.locator('.resource-card').filter({ hasText: title })
    await expect(card).toContainText(current)
    await expect(card).toContainText(`上限 ${limit}`)
    await expect(card).toContainText(percent)
    await expect(card.locator('.resource-card-percent')).toHaveCount(1)
  }
})

test('未配置 Cloudflare 时官方用量为空但平台本地计数仍显示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockWorker(page)
  await page.goto('/usage')

  const official = page.locator('.usage-section').filter({ hasText: 'Cloudflare 免费额度（每日）' })
  const workerCard = official.locator('.resource-card').filter({ hasText: 'Worker 请求' })
  await expect(workerCard).toContainText('—')
  await expect(workerCard).toContainText('未读取')
  await expect(workerCard.locator('.resource-card-percent')).toHaveCount(0)

  const platform = page.locator('.usage-section').filter({ hasText: '平台统计' })
  await expect(platform.locator('.resource-card').filter({ hasText: '平台请求计数' })).toContainText('1,200')
})

test('用量接口 401/403 在用量页显示 HTTP 状态、错误码和消息', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  for (const failure of [
    { status: 401, code: 'credential_invalid', message: 'Invalid Cloudflare credentials' },
    { status: 403, code: 'credential_denied', message: 'Cloudflare credentials cannot access Analytics' },
  ]) {
    worker.usageFault = failure
    await page.goto('/usage')
    const alert = page.locator('.ant-alert').filter({ hasText: `HTTP ${failure.status}` })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(failure.code)
    await expect(alert).toContainText(failure.message)
    expect(new URL(page.url()).pathname).toBe('/usage')
  }
})

test('管理端测试 SMTP 通过后才能保存并清空密码', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/')
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await page.getByRole('menuitem', { name: '邮件 SMTP' }).click()
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
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await page.getByRole('menuitem', { name: '邮件 SMTP' }).click()
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
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await page.getByRole('menuitem', { name: '维护、域名与配额' }).click()
  const panel = page.locator('#settings-maintenance')
  await expect(panel.getByLabel('插件域名后缀')).toHaveValue('.plugins.example.com')
  await panel.getByLabel('插件域名后缀').fill('plugins.example.net')
  await panel.getByRole('button', { name: '保存域名后缀' }).click()
  await expect(page.getByText('插件域名后缀已保存，Cloudflare DNS 和 Worker Route 已同步')).toBeVisible()
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
  await page.getByRole('menuitem', { name: '访问日志', exact: true }).click()

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
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()

  await expect(page.getByText('运行中')).toBeVisible()
  await expect(page.getByText('允许新连接')).toBeVisible()
})

test('管理端设置导航随滚动联动并保持可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await mockWorker(page)
  await page.goto('/')
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()

  const nav = page.getByRole('navigation', { name: '系统设置' })
  const scroller = page.locator('.page-scroll')
  await expect(nav.getByRole('menuitem', { name: 'Cloudflare', exact: true })).toHaveClass(/ant-menu-item-selected/)

  await scroller.evaluate((element) => element.scrollTo({ top: document.getElementById('settings-smtp')!.getBoundingClientRect().top + element.scrollTop - 8 }))
  await expect(nav.getByRole('menuitem', { name: '邮件 SMTP' })).toHaveClass(/ant-menu-item-selected/)

  // 末尾分区通常不足一屏；滚到底触发 hook 的最后分区兜底高亮。
  await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await expect(nav.getByRole('menuitem', { name: '维护、域名与配额' })).toHaveClass(/ant-menu-item-selected/)
  const box = (await nav.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(800)

  await scroller.evaluate((element) => element.scrollTo({ top: 0 }))
  await expect(nav.getByRole('menuitem', { name: 'Cloudflare', exact: true })).toHaveClass(/ant-menu-item-selected/)
})

test('管理端命令面板跨实体搜索并跳转', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const worker = await mockWorker(page)
  worker.servers = [onlineServer]
  worker.plugins = [enabledPlugin]
  worker.domains = [onlineDomain]
  worker.audits = [auditEntry]
  worker.accessLogs = [accessLogEntry]
  const pluginsLoaded = page.waitForResponse((response) => response.url().endsWith('/api/plugins'))
  await page.goto('/')
  worker.releaseLogs()
  await pluginsLoaded

  await page.keyboard.press('Control+k')
  const palette = page.locator('.command-palette')
  await expect(palette).toBeVisible()
  await expect(palette.getByText('页面', { exact: true })).toBeVisible()
  await expect(palette.getByText('设置', { exact: true })).toBeVisible()
  await expect(palette.getByText('本地开发服务器', { exact: true })).toBeVisible()

  const input = palette.getByRole('textbox', { name: '命令面板' })
  await input.fill('示例插件')
  await expect(palette.locator('.command-item').first()).toContainText('示例插件')
  await input.press('Enter')
  await expect(palette).toBeHidden()
  await expect(page.getByRole('heading', { name: '插件实例' })).toBeVisible()

  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await palette.getByRole('textbox', { name: '命令面板' }).fill('维护')
  await palette.getByRole('textbox', { name: '命令面板' }).press('Enter')
  await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '系统设置' }).getByRole('menuitem', { name: '维护、域名与配额' })).toHaveClass(/ant-menu-item-selected/)

  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
})

test('管理端移除背景模糊与背景过渡并使用本地字体', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockWorker(page)
  await page.goto('/')
  await expect(page.getByText('Worker 数据已连接')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  const audit = await page.evaluate(() => {
    const blurred = [...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => getComputedStyle(element).backdropFilter !== 'none')
      .map((element) => element.className)
    const shell = getComputedStyle(document.querySelector('.app-shell')!)
    const sidebar = getComputedStyle(document.querySelector('.sidebar')!)
    const externalFonts = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /fonts\.(googleapis|gstatic)\.com/.test(name))
    return {
      blurred,
      shellTransition: shell.transitionDuration,
      sidebarTransition: sidebar.transitionProperty,
      externalFonts,
      dmSans: document.fonts.check('12px "DM Sans"'),
      plexMono: document.fonts.check('12px "IBM Plex Mono"'),
    }
  })
  expect(audit.blurred).toEqual([])
  expect(audit.shellTransition).toBe('0s')
  expect(audit.sidebarTransition).toBe('transform')
  expect(audit.externalFonts).toEqual([])
  expect(audit.dmSans).toBe(true)
  expect(audit.plexMono).toBe(true)

  const topbar = page.locator('.topbar')
  // AntD 会在挂载后跑一小段颜色过渡，等有限动画结束后再比对，避免把过渡帧当成闪烁。
  await page.waitForFunction(() => document.getAnimations().every((animation) => !(animation instanceof CSSTransition) || animation.playState !== 'running'))
  const first = await topbar.screenshot()
  await page.waitForTimeout(150)
  const second = await topbar.screenshot()
  expect(second.equals(first)).toBe(true)
})

test('管理端入口可跳转并展示账号与协议页', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockWorker(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible()

  await page.getByRole('link', { name: '帮助与协议' }).click()
  await expect(page).toHaveURL(/\/help$/)
  await expect(page.getByRole('heading', { name: '帮助中心' })).toBeVisible()
  await expect(page.getByText('快速开始')).toBeVisible()
  await expect(page.getByText(/⌘K \/ Ctrl\+K/)).toBeVisible()

  await page.getByRole('link', { name: '使用条款' }).click()
  await expect(page).toHaveURL(/\/terms$/)
  await expect(page.getByRole('heading', { name: '可接受的使用' })).toBeVisible()
  await expect(page.getByRole('link', { name: '隐私说明' })).toBeVisible()

  await page.getByRole('link', { name: '返回总览' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible()

  await page.getByRole('button', { name: '当前用户' }).click()
  await page.getByRole('menuitem', { name: '账号' }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'E2E Admin' })).toBeVisible()
  await expect(page.getByText('超级管理员')).toBeVisible()
  await expect(page.getByText('e2e@example.com').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '所属工作区' })).toBeVisible()
  await expect(page.getByRole('link', { name: /默认工作区/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '管理工作区' })).toHaveCount(0)
  await expect(page.getByText('所有者').first()).toBeVisible()

  await page.getByRole('button', { name: '打开账号菜单' }).click()
  await expect(page.getByRole('menuitem', { name: '退出登录' }).last()).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: '隐私说明' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '保留期限' })).toBeVisible()

  await page.goto('/missing-page')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible()
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
  await page.getByRole('menuitem', { name: '插件服务器', exact: true }).click()

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
  await page.getByRole('menuitem', { name: '公开域名', exact: true }).click()
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
  await page.getByRole('menuitem', { name: '公开域名', exact: true }).click()
  await page.getByRole('button', { name: '分配域名' }).click()

  const dialog = page.getByRole('dialog', { name: '分配公开域名' })
  await dialog.getByRole('combobox').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '示例插件' }).click()
  await dialog.getByLabel('域名前缀').fill('Bad Prefix')
  await dialog.getByRole('button', { name: '分配域名' }).click()

  await expect(dialog.getByText('域名前缀仅允许小写字母、数字和连字符', { exact: true })).toBeVisible()
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
  await page.getByRole('menuitem', { name: '公开域名', exact: true }).click()
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
  await page.getByRole('menuitem', { name: '插件实例', exact: true }).click()
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

test('管理端同步 manifest 调用服务器接口并提示结果', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  worker.servers = [onlineServer]
  await page.goto('/')
  await page.getByRole('menuitem', { name: '插件实例', exact: true }).click()

  await page.getByRole('button', { name: '同步 manifest' }).click()

  await expect(page.locator('.ant-notification-notice').filter({ hasText: '已请求 1 台服务器同步 manifest' })).toBeVisible()
  expect(worker.syncRequests).toEqual(['server-1'])
})

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
    // 服务器数量角标会进入可访问名，这里按前缀匹配导航项。
    await page.getByRole('navigation', { name: '主导航' }).getByRole('menuitem', { name: new RegExp(`^${entry.nav}`) }).click()
    await expect(page.getByText(entry.row).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  }

  // 用量页的两组额度卡与设置页的平台 3 项阈值输入都要能在 390px 内排下，不出现横向滚动。
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('menuitem', { name: '用量与配额', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cloudflare 免费额度（每日）' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()

  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('menuitem', { name: '系统设置', exact: true }).click()
  await page.locator('#settings-maintenance').scrollIntoViewIfNeeded()
  await expect(page.locator('#settings-maintenance')).toContainText('平台阈值')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()

  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('menuitem', { name: '插件实例', exact: true }).click()
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

test('管理端切换工作区并管理工作区成员', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const worker = await mockWorker(page)
  await page.goto('/workspaces')

  await expect(page.getByRole('heading', { level: 1, name: '工作区' })).toBeVisible()
  await expect(page.getByText('默认工作区').first()).toBeVisible()
  await expect(page.getByText('e2e@example.com').first()).toBeVisible()

  await page.getByPlaceholder('例如：生产环境').fill('生产环境')
  await page.getByRole('button', { name: '新建工作区' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '工作区已创建' })).toBeVisible()
  await expect(page.getByText('生产环境').first()).toBeVisible()
  expect(worker.workspaceRequests).toContain('POST /api/workspaces')

  await page.getByPlaceholder('member@example.com').fill('ops@example.com')
  await page.getByRole('button', { name: '添加成员' }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '成员已添加' })).toBeVisible()
  await expect(page.getByText('ops@example.com').first()).toBeVisible()

  await page.getByRole('button', { name: '切换工作区' }).click()
  await page.getByRole('menuitem', { name: /默认工作区/ }).click()
  await expect(page.locator('.ant-notification-notice').filter({ hasText: '已切换到工作区「默认工作区」' })).toBeVisible()
})
