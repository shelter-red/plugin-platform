import { expect, test, type Page } from '@playwright/test'

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

type WorkerMock = { failData: boolean; releaseLogs: () => void }

async function mockWorker(page: Page): Promise<WorkerMock> {
  let releaseLogs = () => {}
  const logsGate = new Promise<void>((resolve) => { releaseLogs = resolve })
  const state: WorkerMock = { failData: false, releaseLogs: () => releaseLogs() }

  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/access-logs') {
      await logsGate
      return route.fulfill({ json: { results: [], errorCount: 0, since: '2026-09-21T00:00:00.000Z' } })
    }
    if (state.failData && ['/api/servers', '/api/plugins', '/api/domains'].includes(pathname)) {
      return route.fulfill({ status: 500, json: { error: 'smoke failure' } })
    }
    switch (pathname) {
      case '/api/overview':
        return route.fulfill({ json: overview })
      case '/api/servers':
      case '/api/plugins':
      case '/api/domains':
      case '/api/audit':
        return route.fulfill({ json: { results: [] } })
      case '/api/usage/cloudflare':
        return route.fulfill({ json: { configured: false } })
      case '/api/usage/local':
        return route.fulfill({ json: localUsage })
      case '/api/settings/platform':
        return route.fulfill({ json: platformSettings })
      case '/api/settings/cloudflare':
        return route.fulfill({ json: { configured: false, accountIdConfigured: false, accountId: null, updatedAt: null } })
      case '/api/settings/smtp':
        return route.fulfill({ json: { configured: false } })
      default:
        return route.fulfill({ status: 404, json: { error: 'unexpected smoke path' } })
    }
  })
  return state
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
