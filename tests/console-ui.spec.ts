import { expect, test } from '@playwright/test'

test('管理端桌面空态和主题切换可用', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  await expect(page.getByText('等待 Worker 数据').first()).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)

  await page.getByLabel('选择主题').selectOption('light')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-light/)
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-theme'))).toBe('light')

  await page.getByRole('button', { name: '插件实例' }).click()
  await expect(page.getByRole('heading', { name: '插件实例', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '暂无插件 manifest' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: '/tmp/plugmesh-console-desktop-smoke.png', fullPage: true })
})

test('管理端移动侧栏和布局可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/open/)
  await page.getByRole('button', { name: '系统设置' }).click()
  await expect(page.getByRole('heading', { name: '系统设置', level: 1 })).toBeVisible()
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/plugmesh-console-mobile-smoke.png', fullPage: true })
})
