import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test, vi } from 'vitest'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, setAdminPassword, verifyPassword } from '../src/auth'
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
  const page = await SELF.fetch('https://console.example.com/', { redirect: 'manual' })
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

test('密码表尚未迁移时返回结构化 503 而不是 Worker 1101', async () => {
  await testEnv.DB.prepare('DROP TABLE admin_credentials').run()
  try {
    const health = await SELF.fetch('https://console.example.com/api/health')
    expect(health.status).toBe(503)
    expect(await health.json()).toMatchObject({ ok: false, code: 'migration_required' })

    const page = await SELF.fetch('https://console.example.com/', { redirect: 'manual' })
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toBe('https://console.example.com/setup')

    const setup = await SELF.fetch('https://console.example.com/setup')
    expect(setup.status).toBe(503)
    const html = await setup.text()
    expect(html).toContain('数据库迁移尚未完成')
    expect(html).not.toContain('name="password"')

    const api = await SELF.fetch('https://console.example.com/api/me')
    expect(api.status).toBe(503)
    expect(await api.json()).toMatchObject({ code: 'migration_required' })
  } finally {
    await testEnv.DB.prepare('CREATE TABLE admin_credentials (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)').run()
  }
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

test('超长管理员密码在初始化和登录入口被拒绝', async () => {
  const tooLong = 'x'.repeat(MAX_PASSWORD_LENGTH + 1)
  const setup = await submitSetup(tooLong, tooLong)
  expect(setup.status).toBe(400)
  expect(await setup.text()).toContain(`密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符`)

  await setAdminPassword(testEnv, 'correct-horse-battery')
  const login = await SELF.fetch('https://console.example.com/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: tooLong }) })
  expect(login.status).toBe(401)
  expect((await login.json() as { code: string }).code).toBe('invalid_password')
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
  expect(stored?.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/)
  expect(stored?.password_salt).toBeTruthy()
  expect(stored?.password_hash).not.toContain('correct-horse-battery')
})

test('仍可校验旧版无前缀的 310000 次 PBKDF2 哈希', async () => {
  const password = 'legacy-correct-horse-battery'
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, 256)
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  expect(await verifyPassword(password, encode(new Uint8Array(bits)), encode(salt))).toBe(true)
  expect(await verifyPassword('wrong-password', encode(new Uint8Array(bits)), encode(salt))).toBe(false)
})

test('损坏的管理员凭据按认证失败处理而不抛异常', async () => {
  expect(await verifyPassword('password', 'pbkdf2-sha256$100000$not-base64', 'not-base64')).toBe(false)
})

test('生产已有管理员和默认工作区时可以原子完成初始化', async () => {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('existing-admin', 'legacy-admin', 'admin@example.com', 'Existing administrator', 'super_admin', now),
    testEnv.DB.prepare('UPDATE workspaces SET created_by = ? WHERE id = ?').bind('existing-admin', 'ws_default'),
    testEnv.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind('ws_default', 'existing-admin', 'owner', now),
  ])

  const response = await submitSetup()
  expect(response.status).toBe(303)
  expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>())?.count).toBe(1)
  expect((await testEnv.DB.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind('ws_default', 'existing-admin').first<{ role: string }>())?.role).toBe('owner')
  expect((await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'setup.password.configured'").first<{ count: number }>())?.count).toBe(1)
})

test('初始化批次失败时不留下部分凭据且不再误报 migration', async () => {
  await testEnv.DB.prepare("CREATE TRIGGER fail_setup_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'setup.password.configured' BEGIN SELECT RAISE(ABORT, 'forced setup audit failure'); END").run()
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const response = await submitSetup()
    expect(response.status).toBe(503)
    const html = await response.text()
    expect(html).toContain('管理员密码暂时无法保存')
    expect(html).toContain('错误编号：')
    expect(html).not.toContain('migration')
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM admin_credentials').first<{ count: number }>())?.count).toBe(0)
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>())?.count).toBe(0)
    expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM workspace_members').first<{ count: number }>())?.count).toBe(0)
  } finally {
    consoleError.mockRestore()
    await testEnv.DB.prepare('DROP TRIGGER fail_setup_audit').run()
  }
})

test('修改管理员密码会校验当前密码并撤销全部旧会话', async () => {
  await setAdminPassword(testEnv, 'correct-horse-battery')
  const login = await SELF.fetch('https://console.example.com/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery' }) })
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''

  const rejected = await SELF.fetch('https://console.example.com/api/settings/password', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'new-correct-horse-battery', confirmPassword: 'new-correct-horse-battery' }),
  })
  expect(rejected.status).toBe(401)
  expect(await rejected.json()).toMatchObject({ code: 'current_password_invalid', field: 'currentPassword' })

  const changed = await SELF.fetch('https://console.example.com/api/settings/password', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'correct-horse-battery', newPassword: 'new-correct-horse-battery', confirmPassword: 'new-correct-horse-battery' }),
  })
  expect(changed.status).toBe(204)
  expect((await SELF.fetch('https://console.example.com/api/me', { headers: { cookie } })).status).toBe(401)
  expect((await SELF.fetch('https://console.example.com/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery' }) })).status).toBe(401)
  expect((await SELF.fetch('https://console.example.com/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'new-correct-horse-battery' }) })).status).toBe(204)
})
