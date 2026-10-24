import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { MIN_PASSWORD_LENGTH, setAdminPassword } from '../src/auth'
import { resetDatabase, testEnv } from './helpers'

beforeEach(async () => {
  await resetDatabase()
  await testEnv.DB.prepare('DELETE FROM admin_credentials').run()
})

function submitSetup(password = 'correct-horse-battery', confirmPassword = password): Promise<Response> {
  const form = new URLSearchParams({ password, confirmPassword })
  return SELF.fetch('https://console.example.com/setup', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), redirect: 'manual' })
}

test('未配置密码时所有管理入口都进入 setup', async () => {
  const page = await SELF.fetch('https://console.example.com/')
  expect(page.status).toBe(302)
  expect(page.headers.get('location')).toBe('https://console.example.com/setup')
  const api = await SELF.fetch('https://console.example.com/api/me')
  expect(api.status).toBe(503)
  expect(await api.json()).toEqual({ code: 'setup_required', message: '请先在 setup 页面设置管理员密码' })
  const setup = await SELF.fetch('https://console.example.com/setup')
  expect(setup.status).toBe(200)
  const html = await setup.text()
  expect(html).toContain('管理员密码')
  expect(html).not.toContain('GitHub')
  expect(html).not.toContain('部署令牌')
})

test('setup 校验失败时保留当前页面并允许重新输入', async () => {
  const short = await submitSetup('short', 'short')
  expect(short.status).toBe(400)
  expect(await short.text()).toContain(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`)
  const mismatch = await submitSetup('correct-horse-battery', 'different-password')
  expect(mismatch.status).toBe(400)
  expect(await mismatch.text()).toContain('两次输入的密码不一致')
  expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM admin_credentials').first<{ count: number }>())?.count).toBe(0)
})

test('设置密码后可以使用密码登录，setup 不再初始化', async () => {
  const response = await submitSetup()
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/')
  const locked = await SELF.fetch('https://console.example.com/setup')
  const fallback = await SELF.fetch('https://console.example.com/no-such-route')
  expect(locked.status).toBe(fallback.status)
  expect(await locked.text()).toBe(await fallback.text())
  const wrong = await SELF.fetch('https://console.example.com/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) })
  expect(wrong.status).toBe(401)
  expect((await wrong.json() as { code: string }).code).toBe('invalid_password')
  const login = await SELF.fetch('https://console.example.com/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery' }) })
  expect(login.status).toBe(204)
  expect(login.headers.get('set-cookie')).toContain('plugmesh_session=')
})

test('管理员密码只保存为派生结果，不保存明文', async () => {
  await setAdminPassword(testEnv, 'correct-horse-battery')
  const stored = await testEnv.DB.prepare('SELECT password_hash, password_salt FROM admin_credentials WHERE id = ?').bind('primary').first<{ password_hash: string; password_salt: string }>()
  expect(stored?.password_hash).toBeTruthy()
  expect(stored?.password_salt).toBeTruthy()
  expect(stored?.password_hash).not.toContain('correct-horse-battery')
})
