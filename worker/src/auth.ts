import type { AuthenticatedUser, Env } from './types'

const SESSION_COOKIE = 'plugmesh_session'

export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || null
  }
  return null
}

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

export function isAllowlisted(env: Env, identity: { login: string; emails: string[] }): boolean {
  const configured = (env.GITHUB_ALLOWLIST ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  return configured.includes(identity.login.toLowerCase()) || identity.emails.some((email) => configured.includes(email.toLowerCase()))
}

export async function getCurrentUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return null
  const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), new Date().toISOString()).first<{ user_id: string }>()
  if (!session) return null
  return env.DB.prepare('SELECT id, github_id, email, display_name, role FROM users WHERE id = ?').bind(session.user_id).first<AuthenticatedUser>()
}

export function redirectWithError(request: Request, message: string): Response {
  const location = new URL('/', request.url)
  location.searchParams.set('auth_error', message)
  return Response.redirect(location.toString(), 302)
}

export async function exchangeGithubCode(env: Env, code: string): Promise<{ login: string; emails: string[]; displayName: string; githubId: string } | null> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
  })
  if (!tokenResponse.ok) return null
  const tokenPayload = await tokenResponse.json() as { access_token?: string }
  if (!tokenPayload.access_token) return null
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${tokenPayload.access_token}` }
  const [userResponse, emailResponse] = await Promise.all([fetch('https://api.github.com/user', { headers }), fetch('https://api.github.com/user/emails', { headers })])
  if (!userResponse.ok || !emailResponse.ok) return null
  const githubUser = await userResponse.json() as { id?: number; login?: string; name?: string; email?: string }
  const githubEmails = await emailResponse.json() as Array<{ email?: string; primary?: boolean; verified?: boolean }>
  const emails = githubEmails.filter((item) => item.verified && item.email).map((item) => item.email as string)
  if (githubUser.email && !emails.includes(githubUser.email)) emails.push(githubUser.email)
  if (!githubUser.id || !githubUser.login || emails.length === 0) return null
  return { githubId: String(githubUser.id), login: githubUser.login, emails, displayName: githubUser.name || githubUser.login }
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, await digest(token), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), new Date().toISOString()).run()
  return token
}
