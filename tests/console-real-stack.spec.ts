import { expect, test } from '@playwright/test'
import http from 'node:http'
import { startRealServer } from './real-stack-server'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL
const sessionToken = process.env.PLUGMESH_REAL_STACK_TOKEN ?? 'real-stack-session-token'

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
  } finally {
    await server.stop()
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
