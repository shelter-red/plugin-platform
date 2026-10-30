import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const setupBaseUrl = process.env.PLUGMESH_NATIVE_UI_SETUP_URL ?? 'http://127.0.0.1:18772'

test('local UI first-time binding survives the server restart', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, systemCredentialsAvailable: true } })
  })
  await page.goto(`${setupBaseUrl}/`)

  await expect(page.getByRole('heading', { name: '绑定插件服务器' })).toBeVisible()
  const systemCredentials = page.getByRole('checkbox', { name: '使用系统凭据存储' })
  await expect(systemCredentials).toBeVisible()
  await systemCredentials.check()
  await expect(page.getByLabel('凭据文件路径')).toHaveCount(0)
  await expect(page.getByLabel(/凭据文件加密口令/)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '本地 UI 登录口令', exact: true })).toBeVisible()
  await systemCredentials.uncheck()
  await page.getByLabel('Worker 地址').fill('https://console.example.test')
  await page.getByLabel('服务器名称').fill('Smoke Server')
  await page.getByLabel('一次性注册码').fill('one-time-smoke-code')
  await page.getByLabel('凭据文件路径').fill('smoke-credentials.json')
  await page.getByLabel(/凭据文件加密口令/).fill('credential-password')
  await page.getByRole('textbox', { name: '本地 UI 登录口令', exact: true }).fill('short')
  await page.getByLabel('确认本地 UI 登录口令').fill('short')
  await page.getByRole('button', { name: '绑定服务器' }).click()
  await expect(page.getByText('本地 UI 口令至少需要 8 个字符')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '本地 UI 登录口令', exact: true })).toHaveValue('short')
  await page.getByRole('textbox', { name: '本地 UI 登录口令', exact: true }).fill('setup-password')
  await page.getByLabel('确认本地 UI 登录口令').fill('setup-password')

  const registrationCode = page.getByLabel('一次性注册码')
  const expectBindingError = async (code: string, message: string, hiddenDetail: string, showDetail = false) => {
    await registrationCode.fill(code)
    await page.getByRole('button', { name: '绑定服务器' }).click()
    await expect(page.getByRole('alert')).toContainText(message)
    if (showDetail) {
      await expect(page.getByRole('alert')).toContainText(hiddenDetail)
    } else {
      await expect(page.getByRole('alert')).not.toContainText(hiddenDetail)
    }
  }
  await expectBindingError('invalid-code', '一次性注册码无效或已过期', 'Registration code is invalid')
  await expectBindingError('connection-error', '无法连接 Worker', 'registration connection failed')
  await expectBindingError('tls-error', 'TLS 握手失败', 'certificate verify failed', true)
  await expectBindingError('save-error', '本地凭据保存失败', 'unable to write credential file')

  await registrationCode.fill('one-time-smoke-code')
  await page.getByRole('button', { name: '绑定服务器' }).click()

  await expect(page.getByRole('heading', { name: '登录本地控制台' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('textbox', { name: '本地 UI 登录口令', exact: true }).fill('setup-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '运行概览' })).toBeVisible()
  await expect(page.getByText('smoke-server').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: join(tmpdir(), 'plugmesh-local-setup.png'), fullPage: true })
})
