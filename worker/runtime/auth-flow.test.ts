import { beforeEach, expect, test } from 'vitest'
import { acceptInvite, digest, exchangeGithubCode, upsertGithubUser } from '../src/auth'
import type { Env } from '../src/types'
import { resetDatabase, testEnv } from './helpers'

type Call = { url: string; method: string; authorization: string | null; body: unknown }

function githubFetcher(calls: Call[], overrides: { token?: Response; user?: Response; emails?: Response } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
      body: request.url.endsWith('/access_token') ? await request.json() : null,
    })
    if (request.url === 'https://github.com/login/oauth/access_token') return overrides.token ?? Response.json({ access_token: 'gh-access-token' })
    if (request.url === 'https://api.github.com/user') return overrides.user ?? Response.json({ id: 42, login: 'octocat', name: '' })
    if (request.url === 'https://api.github.com/user/emails') return overrides.emails ?? Response.json([
      { email: 'old@example.com', primary: false, verified: true },
      { email: 'unverified@example.com', primary: true, verified: false },
      { email: 'primary@example.com', primary: true, verified: true },
    ])
    return new Response('unexpected request', { status: 500 })
  }) as typeof fetch
}

const authEnv = (): Env => Object.assign(Object.create(testEnv) as Env, { GITHUB_CLIENT_ID: 'gh-client', GITHUB_CLIENT_SECRET: 'gh-secret' })

async function insertInvite(id: string, options: { email?: string | null; login?: string | null; status?: string; expiresAt?: string } = {}): Promise<string> {
  const token = `invite-token-${id}`
  await testEnv.DB.prepare('INSERT INTO invites (id, token_hash, email, github_login, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
    id,
    await digest(token),
    options.email ?? null,
    options.login ?? null,
    options.status ?? 'pending',
    options.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
    new Date().toISOString(),
  ).run()
  return token
}

beforeEach(async () => {
  await resetDatabase()
})

test('GitHub 代码换取身份时只保留已验证邮箱并按主邮箱排序', async () => {
  const calls: Call[] = []
  const identity = await exchangeGithubCode(authEnv(), 'oauth-code', githubFetcher(calls))
  expect(identity).toEqual({
    githubId: '42',
    login: 'octocat',
    displayName: 'octocat',
    emails: ['primary@example.com', 'old@example.com'],
  })
  expect(calls.map((call) => call.url)).toEqual([
    'https://github.com/login/oauth/access_token',
    'https://api.github.com/user',
    'https://api.github.com/user/emails',
  ])
  expect(calls[0]).toMatchObject({ method: 'POST', authorization: null, body: { client_id: 'gh-client', client_secret: 'gh-secret', code: 'oauth-code' } })
  expect(calls.slice(1).every((call) => call.authorization === 'Bearer gh-access-token')).toBe(true)
})

test('GitHub 换取身份在令牌、用户、邮箱异常时返回 null', async () => {
  const env = authEnv()
  expect(await exchangeGithubCode(env, 'code', githubFetcher([], { token: new Response('unauthorized', { status: 401 }) }))).toBeNull()
  expect(await exchangeGithubCode(env, 'code', githubFetcher([], { token: Response.json({}) }))).toBeNull()
  expect(await exchangeGithubCode(env, 'code', githubFetcher([], { user: new Response('boom', { status: 500 }) }))).toBeNull()
  expect(await exchangeGithubCode(env, 'code', githubFetcher([], { user: Response.json({ login: 'octocat' }) }))).toBeNull()
  expect(await exchangeGithubCode(env, 'code', githubFetcher([], { emails: Response.json([{ email: 'x@example.com', verified: false }]) }))).toBeNull()

  const calls: Call[] = []
  const unconfigured = Object.assign(Object.create(testEnv) as Env, { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' })
  expect(await exchangeGithubCode(unconfigured, 'code', githubFetcher(calls))).toBeNull()
  expect(calls).toHaveLength(0)
})

test('邀请只允许匹配身份、未过期且只能领取一次', async () => {
  const token = await insertInvite('invite-match', { email: 'Invitee@Example.com', login: 'Octocat' })
  const mismatchedEmail = { githubId: 'invite-user', login: 'octocat', emails: ['other@example.com'], displayName: 'Invitee' }
  const mismatchedLogin = { githubId: 'invite-user', login: 'someone', emails: ['invitee@example.com'], displayName: 'Invitee' }
  expect(await acceptInvite(testEnv, await digest(token), mismatchedEmail, 'member')).toBeNull()
  expect(await acceptInvite(testEnv, await digest(token), mismatchedLogin, 'member')).toBeNull()

  const pending = await testEnv.DB.prepare('SELECT status FROM invites WHERE id = ?').bind('invite-match').first<{ status: string }>()
  expect(pending?.status).toBe('pending')

  const identity = { githubId: 'invite-user', login: 'OctoCat', emails: ['INVITEE@example.com'], displayName: 'Invitee' }
  const userId = await acceptInvite(testEnv, await digest(token), identity, 'member')
  expect(userId).toEqual(expect.any(String))
  const user = await testEnv.DB.prepare('SELECT github_id, email, display_name, role FROM users WHERE id = ?').bind(userId).first<Record<string, string>>()
  expect(user).toEqual({ github_id: 'invite-user', email: 'INVITEE@example.com', display_name: 'Invitee', role: 'member' })
  const used = await testEnv.DB.prepare('SELECT status, used_at FROM invites WHERE id = ?').bind('invite-match').first<{ status: string; used_at: string | null }>()
  expect(used?.status).toBe('used')
  expect(used?.used_at).toBeTruthy()
  expect(await acceptInvite(testEnv, await digest(token), identity, 'member')).toBeNull()
})

test('同一邀请并发接受时只创建一个用户', async () => {
  const token = await insertInvite('invite-concurrent', { email: 'concurrent@example.com', login: 'concurrent-user' })
  const identity = { githubId: 'concurrent-user-id', login: 'concurrent-user', emails: ['concurrent@example.com'], displayName: 'Concurrent User' }
  const results = await Promise.all([
    acceptInvite(testEnv, await digest(token), identity, 'member'),
    acceptInvite(testEnv, await digest(token), identity, 'member'),
  ])
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(results.filter((value) => value === null)).toHaveLength(1)
  const users = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE github_id = ?').bind(identity.githubId).first<{ count: number }>()
  expect(users?.count).toBe(1)
  const invite = await testEnv.DB.prepare('SELECT status FROM invites WHERE id = ?').bind('invite-concurrent').first<{ status: string }>()
  expect(invite?.status).toBe('used')
})

test('过期邀请、已撤销邀请和未知令牌无法领取', async () => {
  const expired = await insertInvite('invite-expired', { expiresAt: new Date(Date.now() - 60_000).toISOString() })
  const revoked = await insertInvite('invite-revoked', { status: 'revoked' })
  const identity = { githubId: 'expired-user', login: 'octocat', emails: ['octocat@example.com'], displayName: 'Octocat' }
  expect(await acceptInvite(testEnv, await digest(expired), identity, 'member')).toBeNull()
  expect(await acceptInvite(testEnv, await digest(revoked), identity, 'member')).toBeNull()
  expect(await acceptInvite(testEnv, await digest('missing-token'), identity, 'member')).toBeNull()
  const rows = await testEnv.DB.prepare("SELECT id, status FROM invites ORDER BY id").all<{ id: string; status: string }>()
  expect(rows.results).toEqual([{ id: 'invite-expired', status: 'pending' }, { id: 'invite-revoked', status: 'revoked' }])
})

test('邀请消费与用户创建原子化，用户写入失败时邀请仍可重试', async () => {
  const token = await insertInvite('invite-atomic', { email: 'atomic@example.com', login: 'atomic-user' })
  await expect(acceptInvite(testEnv, await digest(token), {
    githubId: 'atomic-user-id',
    login: 'atomic-user',
    emails: ['atomic@example.com'],
    displayName: null as unknown as string,
  }, 'member')).rejects.toThrow()

  const invite = await testEnv.DB.prepare('SELECT status, used_at FROM invites WHERE id = ?').bind('invite-atomic').first<{ status: string; used_at: string | null }>()
  expect(invite).toEqual({ status: 'pending', used_at: null })
  const users = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>()
  expect(users?.count).toBe(0)
})

test('GitHub 用户按 github_id 去重并更新资料与角色', async () => {
  const first = await upsertGithubUser(testEnv, { githubId: '9001', emails: ['octo@example.com'], displayName: 'Octo' }, 'member')
  const created = await testEnv.DB.prepare('SELECT id, github_id, email, display_name, role FROM users WHERE id = ?').bind(first).first<{ id: string; github_id: string; email: string; display_name: string; role: string }>()
  expect(created).toMatchObject({ github_id: '9001', email: 'octo@example.com', display_name: 'Octo', role: 'member' })

  const second = await upsertGithubUser(testEnv, { githubId: '9001', emails: ['new@example.com'], displayName: 'Octo Renamed' }, 'super_admin')
  expect(second).toBe(first)
  const updated = await testEnv.DB.prepare('SELECT email, display_name, role FROM users WHERE id = ?').bind(first).first<{ email: string; display_name: string; role: string }>()
  expect(updated).toEqual({ email: 'new@example.com', display_name: 'Octo Renamed', role: 'super_admin' })
  const count = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE github_id = ?').bind('9001').first<{ count: number }>()
  expect(count?.count).toBe(1)
})
