import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('local UI session flow is responsive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '登录本地控制台' })).toBeVisible()
  await page.getByLabel('本地 UI 口令').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toContainText('invalid local UI password')

  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已发现插件' })).toBeVisible()
  const samplePlugin = page.locator('.plugin-row', { hasText: 'Sample Plugin' })
  await expect(samplePlugin).toContainText('libplugmesh-sample.so')
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

  await page.getByRole('button', { name: 'Switch language' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-local-language'))).toBe('zh-CN')
})
