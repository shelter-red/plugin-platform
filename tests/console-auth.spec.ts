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
    await expect(page.getByRole('link', { name: /使用 GitHub 登录/ })).toHaveAttribute('href', '/auth/github/start')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)).toEqual([])
    await expect(page).toHaveScreenshot(`console-login-${theme.value}-1440.png`, { fullPage: true, animations: 'disabled' })
  })
}

test('登录页展示邀请文案并保留 invite 参数', async ({ page }) => {
  await page.goto('/?invite=tok_123')
  await expect(page.getByRole('heading', { name: '接受平台邀请', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /使用 GitHub 登录/ })).toHaveAttribute('href', '/auth/github/start?invite=tok_123')
  await expect(page.getByText('平台会在登录后完成身份匹配')).toBeVisible()
})

test('登录页展示回调错误并保留 GitHub 入口', async ({ page }) => {
  await page.goto(`/?auth_error=${encodeURIComponent('OAuth 状态已过期')}`)
  await expect(page.getByRole('alert')).toContainText('OAuth 状态已过期')
  await expect(page.getByRole('link', { name: /使用 GitHub 登录/ })).toHaveAttribute('href', '/auth/github/start')
})

test('登录页窄窗口不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '登录 Plugmesh', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})
