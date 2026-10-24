import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// 登录页运行在启用鉴权的开发服务器上：/api/me 无后端时返回失败，控制台进入匿名态。
const themes = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

for (const theme of themes) {
  test(`登录页（${theme.label}主题）渲染并通过 axe 扫描`, async ({ page }) => {
    await page.addInitScript((value) => window.localStorage.setItem('plugmesh-theme', value), theme.value)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '登录 Plugmesh', level: 1 })).toBeVisible()
    await expect(page.locator('.auth-screen')).toHaveClass(new RegExp(`theme-${theme.value}`))
    await expect(page.getByLabel('管理员密码')).toBeVisible()
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)).toEqual([])
    await expect(page).toHaveScreenshot(`console-login-${theme.value}-1440.png`, { fullPage: true, animations: 'disabled' })
  })
}

test('登录页窄窗口不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '登录 Plugmesh', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})

test('未初始化时管理端进入 setup 页面', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'setup_required', message: '请先设置管理员密码' }),
  }))
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
})
