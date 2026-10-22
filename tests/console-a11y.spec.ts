import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// 计划 §10：死控件由 ui:conventions 审计，可访问性由 axe 在静态预览上按双主题逐页扫描。
const pages = ['/', '/servers', '/plugins', '/domains', '/workspaces', '/logs', '/audit', '/usage', '/settings', '/account', '/help', '/terms', '/privacy']
const themes = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

for (const theme of themes) {
  for (const path of pages) {
    test(`管理端 ${path}（${theme.label}主题）通过 axe 可访问性扫描`, async ({ page }) => {
      await page.addInitScript((value) => window.localStorage.setItem('plugmesh-theme', value), theme.value)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)).toEqual([])
    })
  }
}
