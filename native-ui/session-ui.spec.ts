import { expect, test } from '@playwright/test'

test('local UI session flow is responsive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('http://127.0.0.1:18771/')

  await expect(page.getByRole('heading', { name: '登录本地控制台' })).toBeVisible()
  await page.getByLabel('本地 UI 口令').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toContainText('invalid local UI password')

  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '已发现插件' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: '/tmp/plugmesh-local-desktop.png', fullPage: true })

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '登录本地控制台' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('本地 UI 口令').fill('smoke-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '插件服务器' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: '/tmp/plugmesh-local-mobile.png', fullPage: true })
})
