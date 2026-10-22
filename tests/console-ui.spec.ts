import { expect, test, type Page } from '@playwright/test'

async function selectAntOption(page: Page, selector: string, option: string) {
  await page.locator(selector).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('管理端桌面空态和主题切换可用', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  await expect(page.getByText('等待 Worker 数据').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '最近错误和连接异常' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '暂无错误摘要' })).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)
  await expect(page).toHaveScreenshot('console-desktop-dark.png', { fullPage: true, animations: 'disabled' })

  await selectAntOption(page, '.theme-menu:not(.language-menu) .ant-select', '浅色')
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
  await expect(page).toHaveScreenshot('console-mobile-settings.png', { fullPage: true, animations: 'disabled' })
})

test('管理端系统主题跟随系统偏好并持久化', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')

  await selectAntOption(page, '.theme-menu:not(.language-menu) .ant-select', '系统')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-light/)
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-theme'))).toBe('system')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)

  await page.reload()
  await expect(page.locator('.theme-menu:not(.language-menu) .ant-select-selection-item')).toHaveText('系统')
  await expect(page.locator('.app-shell')).toHaveClass(/theme-dark/)
})

const emptyPages: { nav: string; title: string; empty: string; extra?: string }[] = [
  { nav: '插件服务器', title: '插件服务器', empty: '暂无已绑定服务器' },
  { nav: '插件实例', title: '插件实例', empty: '暂无插件 manifest' },
  { nav: '公开域名', title: '公开域名', empty: '暂无公开域名' },
  { nav: '访问日志', title: '访问日志', empty: '暂无访问日志' },
  { nav: '审计日志', title: '审计日志', empty: '暂无审计记录' },
  { nav: '用量与配额', title: '用量与配额', empty: '官方数据尚未连接' },
  { nav: '系统设置', title: '系统设置', empty: '维护状态未读取', extra: '邀请数据未接入' },
]

test('管理端各页面展示真实空态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()

  for (const entry of emptyPages) {
    await page.getByRole('button', { name: entry.nav, exact: true }).click()
    await expect(page.getByRole('heading', { name: entry.title, level: 1 })).toBeVisible()
    await expect(page.getByText(entry.empty).first()).toBeVisible()
    if (entry.extra) await expect(page.getByText(entry.extra).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  }
  await page.screenshot({ path: '/tmp/plugmesh-console-empty-states.png', fullPage: true })
})

test('管理端窄窗口各页面空态可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  for (const entry of emptyPages) {
    await page.getByRole('button', { name: '打开导航' }).click()
    await page.getByRole('button', { name: entry.nav, exact: true }).click()
    await expect(page.getByRole('heading', { name: entry.title, level: 1 })).toBeVisible()
    await expect(page.getByText(entry.empty).first()).toBeVisible()
    await expect(page.locator('.sidebar')).not.toHaveClass(/open/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  }
})

test('管理端窄窗口弹窗可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '插件实例', exact: true }).click()
  await page.getByRole('button', { name: '加载插件' }).first().click()

  const dialog = page.getByRole('dialog', { name: '加载插件' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('暂无可加载插件')).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('管理端中英切换并持久化', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN')

  await selectAntOption(page, '.theme-menu.language-menu .ant-select', 'English')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plugin instances', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Select theme' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-language'))).toBe('en')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  await selectAntOption(page, '.theme-menu.language-menu .ant-select', '中文')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('plugmesh-language'))).toBe('zh-CN')
})
