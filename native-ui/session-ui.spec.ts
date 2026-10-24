import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('local UI session flow is responsive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '登录本地控制台' })).toBeVisible()
  await page.getByLabel('本地 UI 口令').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toContainText('本地 UI 口令不正确')
  await expect(page.getByRole('alert')).not.toContainText('invalid local UI password')

  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已发现插件' })).toBeVisible()
  const samplePlugin = page.locator('.plugin-row', { hasText: 'Sample Plugin' })
  await expect(samplePlugin).toContainText(/libplugmesh-sample\.(so|dll)/)
  await expect(samplePlugin).toContainText('健康检查: /health')
  await expect(samplePlugin).toContainText('权限: 无')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: join(tmpdir(), 'plugmesh-local-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '登录本地控制台' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: join(tmpdir(), 'plugmesh-local-mobile.png'), fullPage: true })
})

test('local UI diagnostics and logs follow plugin lifecycle actions', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()

  const metric = (label: string) => page.locator('.metric', { hasText: label })
  await expect(metric('已发现插件').locator('strong')).toHaveText('4')
  await expect(metric('已启用').locator('strong')).toHaveText('0')
  await expect(metric('失败状态').locator('strong')).toHaveText('0')
  await expect(metric('本地端口').locator('strong')).toHaveText(/^\d+$/)

  const samplePlugin = page.locator('.plugin-row', { hasText: 'Sample Plugin' })
  await expect(samplePlugin).toContainText('已发现')
  await samplePlugin.getByRole('button', { name: '加载' }).click()
  await expect(samplePlugin).toContainText('已加载')
  await samplePlugin.getByRole('button', { name: '启用' }).click()
  await expect(samplePlugin).toContainText('已启用')
  await expect(metric('已启用').locator('strong')).toHaveText('1')

  await samplePlugin.getByRole('button', { name: '检查' }).click()
  await expect(page.getByRole('status')).toContainText('健康检查通过')

  await samplePlugin.getByRole('button', { name: '停用' }).click()
  await expect(samplePlugin).toContainText('已停用')
  await expect(metric('已启用').locator('strong')).toHaveText('0')

  await samplePlugin.getByRole('button', { name: '重载' }).click()
  await expect(page.getByRole('status')).toContainText('已停用')

  await samplePlugin.getByRole('button', { name: '卸载' }).click()
  await expect(samplePlugin).toContainText('已卸载')

  const logSection = page.locator('#logs')
  await expect(logSection).toContainText('plugin loaded: sample.plugin')
  await expect(logSection).toContainText('plugin enabled: sample.plugin')
  await expect(logSection).toContainText('plugin disabled: sample.plugin')
  await expect(logSection).toContainText('plugin reloaded: sample.plugin')
  await expect(logSection).toContainText('plugin unloaded: sample.plugin')
  await expect(logSection.locator('.log-row').first()).toContainText('INFO')
  await expect(page.locator('a.side-link[href="#logs"] span')).toHaveText(/^[1-9]\d*$/)
})

test('local UI theme switches between dark, light and system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const shell = page.locator('.local-app')
  const toggle = page.getByRole('button', { name: '切换主题' })

  await expect(shell).toHaveClass(/theme-dark/)
  await toggle.click()
  await expect(shell).toHaveClass(/theme-light/)
  await toggle.click()
  await expect(shell).toHaveClass(/theme-dark/)
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-local-theme'))).toBe('system')

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(shell).toHaveClass(/theme-light/)
})

test('local UI switches between Chinese and English and persists the choice', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

  await page.getByRole('button', { name: '切换语言' }).click()
  await expect(page.getByRole('heading', { name: 'Plugin server' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discovered plugins' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-local-language'))).toBe('en')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Plugin server' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to local console' })).toBeVisible()
  await page.getByLabel('Local UI password', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('The local UI password is incorrect')
  await page.getByLabel('Local UI password', { exact: true }).fill('smoke-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Plugin server' })).toBeVisible()

  await page.getByRole('button', { name: 'Switch language' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-local-language'))).toBe('zh-CN')
})
