import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { resetDatabase, testEnv } from './helpers'

const SETUP_TOKEN = 'runtime-setup-token'

beforeEach(async () => {
  await resetDatabase()
})

function submitSetup(overrides: Record<string, string> = {}): Promise<Response> {
  const form = new URLSearchParams({
    setupToken: SETUP_TOKEN,
    clientId: 'setup-github-client',
    clientSecret: 'setup-github-secret',
    allowlist: 'runtime-admin',
    ...overrides,
  })
  return SELF.fetch('https://console.example.com/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  })
}

test('初始化页拒绝错误部署令牌且不保存 OAuth 配置', async () => {
  const page = await SELF.fetch('https://console.example.com/setup')
  expect(page.status).toBe(200)
  const html = await page.text()
  expect(html).toContain('初始化 Plugmesh')
  expect(html).toContain('部署令牌')
  expect(html).toContain('<span>Homepage URL</span><code>https://console.example.com/</code>')
  expect(html).toContain('<span>Authorization callback URL</span><code>https://console.example.com/auth/github/callback</code>')
  expect(html.match(/\/auth\/github\/callback/g)).toHaveLength(1)
  expect(html).not.toContain('name="redirectUri"')
  expect(html).not.toContain(SETUP_TOKEN)

  const response = await submitSetup({ setupToken: 'wrong-token' })
  expect(response.status).toBe(401)
  expect(await response.text()).toContain('部署令牌不正确')
  const stored = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM oauth_settings').first<{ count: number }>()
  expect(stored?.count).toBe(0)
})

test('正确初始化后 GitHub 白名单账号成为首个超级管理员，入口永久锁定', async () => {
  const response = await submitSetup()
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/auth/github/start')

  const stored = await testEnv.DB.prepare('SELECT ciphertext, iv FROM oauth_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  expect(stored).toBeTruthy()
  expect(stored?.ciphertext).not.toContain('setup-github-client')
  expect(stored?.ciphertext).not.toContain('setup-github-secret')

  const start = await SELF.fetch('https://console.example.com/auth/github/start', { redirect: 'manual' })
  expect(start.status).toBe(302)
  const authorize = new URL(start.headers.get('location') ?? '')
  expect(authorize.searchParams.get('client_id')).toBe('setup-github-client')
  expect(authorize.searchParams.get('redirect_uri')).toBe('https://console.example.com/auth/github/callback')
  const state = authorize.searchParams.get('state') ?? ''

  const callback = await SELF.fetch(`https://console.example.com/auth/github/callback?code=runtime-admin&state=${encodeURIComponent(state)}`, { redirect: 'manual' })
  expect(callback.status).toBe(302)
  expect(callback.headers.get('location')).toBe('/')
  const cookie = callback.headers.get('set-cookie') ?? ''
  expect(cookie).toContain('plugmesh_session=')

  const user = await testEnv.DB.prepare('SELECT email, role FROM users WHERE github_id = ?').bind('1001').first<{ email: string; role: string }>()
  expect(user).toEqual({ email: 'admin@example.com', role: 'super_admin' })

  const token = decodeURIComponent(cookie.split(';')[0]!.slice('plugmesh_session='.length))
  const settings = await SELF.fetch('https://console.example.com/api/settings/oauth', { headers: { cookie: `plugmesh_session=${token}` } })
  expect(settings.status).toBe(200)
  const payload = await settings.json() as Record<string, unknown>
  expect(JSON.stringify(payload)).not.toContain('setup-github-secret')
  expect((payload.github as { configured: boolean }).configured).toBe(true)

  const locked = await submitSetup()
  const fallback = await SELF.fetch('https://console.example.com/no-such-route', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'setupToken=runtime-setup-token',
    redirect: 'manual',
  })
  expect(locked.status).toBe(fallback.status)
  const lockedBody = new TextDecoder().decode(await locked.arrayBuffer())
  const fallbackBody = new TextDecoder().decode(await fallback.arrayBuffer())
  expect(lockedBody).toBe(fallbackBody)

  const lockedPage = await SELF.fetch('https://console.example.com/setup', { redirect: 'manual' })
  const fallbackPage = await SELF.fetch('https://console.example.com/no-such-route', { redirect: 'manual' })
  expect(lockedPage.status).toBe(fallbackPage.status)
  expect(await lockedPage.text()).toBe(await fallbackPage.text())
})
