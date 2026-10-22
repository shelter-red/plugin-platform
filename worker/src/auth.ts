import { getCookie } from './cookies'
import { resolveOauthSettings } from './oauth-settings'
import type { AuthenticatedUser, Env, WorkspaceRole } from './types'

const SESSION_COOKIE = 'plugmesh_session'

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function isAllowlisted(env: Env, identity: { login: string; emails: string[] }): Promise<boolean> {
  const { github } = await resolveOauthSettings(env)
  const configured = github?.allowlist ?? []
  return configured.includes(identity.login.toLowerCase()) || identity.emails.some((email) => configured.includes(email.toLowerCase()))
}

export async function acceptInvite(env: Env, tokenHash: string, identity: { login: string; emails: string[]; displayName: string; githubId: string }, role: AuthenticatedUser['role']): Promise<string | null> {
  const now = new Date().toISOString()
  const invite = await env.DB.prepare('SELECT id, email, github_login, workspace_id, role FROM invites WHERE token_hash = ? AND status = ? AND expires_at > ?').bind(tokenHash, 'pending', now).first<{ id: string; email: string | null; github_login: string | null; workspace_id: string; role: WorkspaceRole }>()
  if (!invite || (invite.email && !identity.emails.some((email) => email.toLowerCase() === invite.email?.toLowerCase())) || (invite.github_login && invite.github_login.toLowerCase() !== identity.login.toLowerCase())) return null

  const candidateId = crypto.randomUUID()
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, github_id, email, display_name, role, created_at)
      SELECT ?, ?, ?, ?, ?, ?
      FROM invites
      WHERE id = ? AND token_hash = ? AND status = ? AND expires_at > ?
      ON CONFLICT(github_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, role = excluded.role
    `).bind(candidateId, identity.githubId, identity.emails[0], identity.displayName, role, now, invite.id, tokenHash, 'pending', now),
    env.DB.prepare('UPDATE invites SET status = ?, used_at = ? WHERE id = ? AND token_hash = ? AND status = ? AND expires_at > ?').bind('used', now, invite.id, tokenHash, 'pending', now),
    env.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) SELECT ?, id, ?, ? FROM users WHERE github_id = ? ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role').bind(invite.workspace_id, invite.role, now, identity.githubId),
  ])
  if ((results[1]?.meta.changes ?? 0) !== 1) return null
  const user = await env.DB.prepare('SELECT id FROM users WHERE github_id = ?').bind(identity.githubId).first<{ id: string }>()
  if (!user) throw new Error('Invited GitHub user could not be saved')
  return user.id
}

export async function upsertGithubUser(env: Env, identity: { emails: string[]; displayName: string; githubId: string }, role: AuthenticatedUser['role']): Promise<string> {
  const candidateId = crypto.randomUUID()
  await env.DB.prepare(`
    INSERT INTO users (id, github_id, email, display_name, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, role = excluded.role
  `).bind(candidateId, identity.githubId, identity.emails[0], identity.displayName, role, new Date().toISOString()).run()
  const user = await env.DB.prepare('SELECT id FROM users WHERE github_id = ?').bind(identity.githubId).first<{ id: string }>()
  if (!user) throw new Error('GitHub user could not be saved')
  return user.id
}

export async function getCurrentUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return null
  const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), new Date().toISOString()).first<{ user_id: string }>()
  if (!session) return null
  return env.DB.prepare('SELECT id, github_id, email, display_name, role FROM users WHERE id = ?').bind(session.user_id).first<AuthenticatedUser>()
}

// 登录回调失败由 auth-error-page 直接返回 HTTP 错误状态与可读页面；
// 错误码只用于服务端映射状态与文案，不再写进 URL 查询参数。
export const authErrorCodes = ['callback_incomplete', 'state_expired', 'state_used', 'oauth_not_configured', 'token_exchange_failed', 'user_api_failed', 'email_api_failed', 'identity_incomplete', 'email_unverified', 'invite_mismatch', 'invite_required'] as const
export type AuthErrorCode = (typeof authErrorCodes)[number]

export interface GithubIdentity {
  login: string
  emails: string[]
  displayName: string
  githubId: string
}

export type GithubAuthFailureReason =
  | 'not_configured'
  | 'token_exchange_failed'
  | 'user_api_failed'
  | 'email_api_failed'
  | 'identity_incomplete'
  | 'no_verified_email'

export type GithubAuthResult =
  | { ok: true; identity: GithubIdentity }
  | { ok: false; reason: GithubAuthFailureReason; status?: number; detail?: string }

function safeDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, 120)
  return normalized || undefined
}

// GitHub API 会对缺少 User-Agent 的请求直接返回 403，Workers 的 fetch 默认不携带。
const GITHUB_USER_AGENT = 'plugmesh-platform'

async function failureDetail(response: Response): Promise<string | undefined> {
  const payload = await response.clone().json().catch(() => null) as { message?: string } | null
  const message = safeDetail(payload?.message)
  if (message) return message
  if (response.headers.get('x-ratelimit-remaining') === '0') return 'GitHub API 速率限制已用尽'
  return undefined
}

export async function exchangeGithubCode(env: Env, code: string, fetchImpl: typeof fetch = fetch): Promise<GithubAuthResult> {
  const { github } = await resolveOauthSettings(env)
  if (!github) return { ok: false, reason: 'not_configured' }
  const tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: github.clientId, client_secret: github.clientSecret, code, redirect_uri: github.redirectUri }),
  })
  if (!tokenResponse.ok) return { ok: false, reason: 'token_exchange_failed', status: tokenResponse.status }
  const tokenPayload = await tokenResponse.json().catch(() => null) as { access_token?: string; error?: string; error_description?: string } | null
  if (!tokenPayload?.access_token) {
    const detail = safeDetail(tokenPayload?.error_description) ?? safeDetail(tokenPayload?.error)
    return { ok: false, reason: 'token_exchange_failed', status: tokenResponse.status, detail }
  }
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${tokenPayload.access_token}`,
    'user-agent': GITHUB_USER_AGENT,
    'x-github-api-version': '2022-11-28',
  }
  const [userResponse, emailResponse] = await Promise.all([fetchImpl('https://api.github.com/user', { headers }), fetchImpl('https://api.github.com/user/emails', { headers })])
  if (!userResponse.ok) return { ok: false, reason: 'user_api_failed', status: userResponse.status, detail: await failureDetail(userResponse) }
  if (!emailResponse.ok) return { ok: false, reason: 'email_api_failed', status: emailResponse.status, detail: await failureDetail(emailResponse) }
  const githubUser = await userResponse.json().catch(() => null) as { id?: number; login?: string; name?: string } | null
  const githubEmails = await emailResponse.json().catch(() => null) as Array<{ email?: string; primary?: boolean; verified?: boolean }> | null
  if (!githubUser?.id || !githubUser.login) return { ok: false, reason: 'identity_incomplete' }
  const emails = (Array.isArray(githubEmails) ? githubEmails : [])
    .filter((item): item is { email: string; primary?: boolean; verified: true } => item.verified === true && typeof item.email === 'string' && item.email.length > 0)
    .sort((left, right) => Number(Boolean(right.primary)) - Number(Boolean(left.primary)))
    .map((item) => item.email)
  if (emails.length === 0) return { ok: false, reason: 'no_verified_email' }
  return { ok: true, identity: { githubId: String(githubUser.id), login: githubUser.login, emails, displayName: githubUser.name || githubUser.login } }
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, await digest(token), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), new Date().toISOString()).run()
  return token
}
