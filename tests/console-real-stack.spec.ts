import { expect, test } from '@playwright/test'

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
