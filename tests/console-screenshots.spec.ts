import { expect, test } from '@playwright/test'

// 计划 §10：双主题 × 1440/1024/390 截图快照，覆盖总览、列表与设置三类代表页面。
const targets = [
  { path: '/', name: 'dashboard' },
  { path: '/plugins', name: 'plugins' },
  { path: '/settings', name: 'settings' },
]
const themes = [
  { value: 'dark', name: 'dark' },
  { value: 'light', name: 'light' },
]
const viewports = [
  { width: 1440, height: 1000, name: '1440' },
  { width: 1024, height: 900, name: '1024' },
  { width: 390, height: 844, name: '390' },
]

for (const theme of themes) {
  for (const viewport of viewports) {
    for (const target of targets) {
      test(`管理端截图 ${target.name} ${theme.name} ${viewport.name}`, async ({ page }) => {
        await page.addInitScript((value) => window.localStorage.setItem('plugmesh-theme', value), theme.value)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(target.path)
        await expect(page.locator('main')).toBeVisible()
        await expect(page.locator('.app-shell')).toHaveClass(new RegExp(`theme-${theme.value}`))
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`console-${target.name}-${theme.name}-${viewport.name}.png`, { fullPage: true, animations: 'disabled' })
      })
    }
  }
}
