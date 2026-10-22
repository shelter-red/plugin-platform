import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { digest } from '../src/auth'
import { resetDatabase, testEnv } from './helpers'

const INVITE_TOKEN = 'oauth-route-invite-token'

beforeEach(async () => {
  await resetDatabase()
  await testEnv.DB.prepare('INSERT INTO invites (id, token_hash, email, github_login, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('invite-oauth-route', await digest(INVITE_TOKEN), 'invitee@example.com', null, 'pending', new Date(Date.now() + 3_600_000).toISOString(), new Date().toISOString())
    .run()
})

async function startAuth(invite?: string): Promise<URL> {
  const response = await SELF.fetch(`https://console.example.com/auth/github/start${invite ? `?invite=${invite}` : ''}`, { redirect: 'manual' })
  expect(response.status).toBe(302)
  const authorize = new URL(response.headers.get('location') ?? '')
  expect(authorize.origin).toBe('https://github.com')
  expect(authorize.pathname).toBe('/login/oauth/authorize')
  expect(authorize.searchParams.get('client_id')).toBe('runtime-github-client')
  expect(authorize.searchParams.get('redirect_uri')).toBe('https://console.example.com/auth/github/callback')
  expect(authorize.searchParams.get('scope')).toBe('read:user user:email')
  return authorize
}

const callback = (state: string, code: string) => SELF.fetch(`https://console.example.com/auth/github/callback?code=${code}&state=${encodeURIComponent(state)}`, { redirect: 'manual' })

test('GitHub 授权跳转写入 state，回调领取邀请并创建会话', async () => {
  const code = 'octocat'
  const authorize = await startAuth(INVITE_TOKEN)
  const state = authorize.searchParams.get('state') ?? ''
  const stored = await testEnv.DB.prepare('SELECT invite_token_hash FROM oauth_states WHERE state_hash = ?').bind(await digest(state)).first<{ invite_token_hash: string | null }>()
  expect(stored?.invite_token_hash).toBe(await digest(INVITE_TOKEN))

  const response = await callback(state, code)
  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe('/')
  const cookie = response.headers.get('set-cookie') ?? ''
  expect(cookie).toContain('plugmesh_session=')
  expect(cookie).toContain('HttpOnly')

  const invite = await testEnv.DB.prepare('SELECT status FROM invites WHERE id = ?').bind('invite-oauth-route').first<{ status: string }>()
  expect(invite?.status).toBe('used')
  const user = await testEnv.DB.prepare('SELECT email, display_name, role FROM users WHERE github_id = ?').bind('4242').first<{ email: string; display_name: string; role: string }>()
  expect(user).toEqual({ email: 'invitee@example.com', display_name: 'Octo Cat', role: 'member' })

  const token = decodeURIComponent(cookie.split(';')[0]!.slice('plugmesh_session='.length))
  const me = await SELF.fetch('https://console.example.com/api/me', { headers: { cookie: `plugmesh_session=${token}` } })
  expect(me.status).toBe(200)
  expect((await me.json() as { user: { role: string } }).user.role).toBe('member')
})

test('未受邀身份被拒绝且 state 只能使用一次', async () => {
  const code = 'stranger'
  const authorize = await startAuth()
  const state = authorize.searchParams.get('state') ?? ''

  const rejected = await callback(state, code)
  expect(rejected.status).toBe(302)
  expect(new URL(rejected.headers.get('location') ?? '').searchParams.get('auth_error')).toBe('invite_required')
  expect((await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>())?.count).toBe(0)

  const replayed = await callback(state, code)
  expect(new URL(replayed.headers.get('location') ?? '').searchParams.get('auth_error')).toBe('state_expired')
})

test('白名单 GitHub 登录直接成为超级管理员', async () => {
  const code = 'runtime-admin'
  const authorize = await startAuth()
  const state = authorize.searchParams.get('state') ?? ''

  const response = await callback(state, code)
  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe('/')
  const user = await testEnv.DB.prepare('SELECT role FROM users WHERE github_id = ?').bind('1001').first<{ role: string }>()
  expect(user?.role).toBe('super_admin')
})
