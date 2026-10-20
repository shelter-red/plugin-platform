import { PluginBridge } from './durable-object'
import { makeFrame, parseControlFrame } from './protocol'
import { hashControlToken } from './security'
import { createSession, digest, exchangeGithubCode, getCurrentUser, isAllowlisted, redirectWithError, sessionCookie, clearSessionCookie } from './auth'
import type { AuthenticatedUser, Env } from './types'

export { PluginBridge }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return json({ ok: true, service: 'plugmesh-worker', protocolVersion: 1 })
    if (url.pathname === '/auth/github/start') return startGithubAuth(request, env, url)
    if (url.pathname === '/auth/github/callback') return finishGithubAuth(request, env, url)
    if (url.pathname === '/auth/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearSessionCookie(url.protocol === 'https:') } })
    if (url.pathname === '/control/register') return registerServer(request, env)
    if (url.pathname.startsWith('/api/')) return api(request, env, url)
    if (url.pathname === '/control/connect') return connectServer(request, env, url)
    return proxyPublicHost(request, env, url)
  },
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getCurrentUser(request, env)
  if (!user) return json({ error: 'Authentication required' }, 401)
  if (url.pathname === '/api/me') return json({ user })
  if (request.method === 'GET' && url.pathname === '/api/overview') {
    const [servers, plugins, domains] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM servers WHERE user_id = ? AND status = ?').bind(user.id, 'online').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM plugin_instances WHERE user_id = ? AND state = ?').bind(user.id, 'enabled').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM domains WHERE user_id = ?').bind(user.id).first<{ count: number }>(),
    ])
    return json({ onlineServers: servers?.count ?? 0, enabledPlugins: plugins?.count ?? 0, domains: domains?.count ?? 0 })
  }
  if (request.method === 'GET' && url.pathname === '/api/servers') return json(await env.DB.prepare('SELECT id, name, status, last_seen_at, created_at FROM servers WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all())
  if (request.method === 'GET' && url.pathname === '/api/plugins') return json(await env.DB.prepare('SELECT id, plugin_id, name, version, state, server_id, updated_at FROM plugin_instances WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all())
  if (request.method === 'GET' && url.pathname === '/api/domains') return json(await env.DB.prepare('SELECT id, hostname, status, plugin_instance_id, created_at FROM domains WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all())
  if (request.method === 'GET' && url.pathname === '/api/invites') {
    if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
    return json(await env.DB.prepare('SELECT id, email, github_login, status, expires_at, used_at, created_at FROM invites ORDER BY created_at DESC').all())
  }
  if (request.method === 'POST' && url.pathname === '/api/invites') return createInvite(request, env, user)
  if (request.method === 'POST' && url.pathname === '/api/registration-codes') return createRegistrationCode(env, user)
  return json({ error: 'Not found' }, 404)
}

async function startGithubAuth(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_REDIRECT_URI) return new Response('GitHub OAuth is not configured', { status: 503 })
  const state = crypto.randomUUID()
  const inviteToken = url.searchParams.get('invite')
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, invite_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await digest(state), inviteToken ? await digest(inviteToken) : null, new Date(Date.now() + 10 * 60 * 1000).toISOString(), new Date().toISOString()).run()
  const githubUrl = new URL('https://github.com/login/oauth/authorize')
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  githubUrl.searchParams.set('redirect_uri', env.GITHUB_REDIRECT_URI)
  githubUrl.searchParams.set('scope', 'read:user user:email')
  githubUrl.searchParams.set('state', state)
  return Response.redirect(githubUrl.toString(), 302)
}

async function finishGithubAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!state || !code) return redirectWithError(request, 'OAuth 回调参数不完整')
  const oauthState = await env.DB.prepare('SELECT state_hash, invite_token_hash FROM oauth_states WHERE state_hash = ? AND expires_at > ?').bind(await digest(state), new Date().toISOString()).first<{ state_hash: string; invite_token_hash: string | null }>()
  if (!oauthState) return redirectWithError(request, 'OAuth 状态已过期')
  await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ?').bind(oauthState.state_hash).run()
  const identity = await exchangeGithubCode(env, code)
  if (!identity) return redirectWithError(request, '无法读取 GitHub 身份')
  const allowlisted = isAllowlisted(env, { login: identity.login, emails: identity.emails })
  let invite: { id: string; email: string | null; github_login: string | null } | null = null
  if (oauthState.invite_token_hash) {
    invite = await env.DB.prepare('SELECT id, email, github_login FROM invites WHERE token_hash = ? AND status = ? AND expires_at > ?').bind(oauthState.invite_token_hash, 'pending', new Date().toISOString()).first()
    if (!invite || (invite.email && !identity.emails.some((email) => email.toLowerCase() === invite?.email?.toLowerCase())) || (invite.github_login && invite.github_login.toLowerCase() !== identity.login.toLowerCase())) return redirectWithError(request, '邀请身份不匹配或已失效')
  }
  if (!allowlisted && !invite) return redirectWithError(request, '该 GitHub 身份未被邀请')
  const role = allowlisted ? 'super_admin' : 'member'
  const existing = await env.DB.prepare('SELECT id FROM users WHERE github_id = ?').bind(identity.githubId).first<{ id: string }>()
  const userId = existing?.id ?? crypto.randomUUID()
  if (existing) await env.DB.prepare('UPDATE users SET email = ?, display_name = ?, role = ? WHERE id = ?').bind(identity.emails[0], identity.displayName, role, userId).run()
  else await env.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(userId, identity.githubId, identity.emails[0], identity.displayName, role, new Date().toISOString()).run()
  if (invite) await env.DB.prepare('UPDATE invites SET status = ?, used_at = ? WHERE id = ?').bind('used', new Date().toISOString(), invite.id).run()
  const token = await createSession(env, userId)
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': sessionCookie(token, url.protocol === 'https:') } })
}

async function createInvite(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const body = await request.json().catch(() => null) as { email?: string; githubLogin?: string; expiresInHours?: number } | null
  const expiresInHours = Math.min(Math.max(body?.expiresInHours ?? 72, 1), 720)
  const rawToken = crypto.randomUUID() + crypto.randomUUID()
  const invite = { id: crypto.randomUUID(), email: body?.email?.trim() || null, githubLogin: body?.githubLogin?.trim() || null, expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString() }
  await env.DB.prepare('INSERT INTO invites (id, token_hash, email, github_login, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(invite.id, await digest(rawToken), invite.email, invite.githubLogin, 'pending', invite.expiresAt, new Date().toISOString()).run()
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'invite.created', JSON.stringify({ inviteId: invite.id }), new Date().toISOString()).run()
  return json({ id: invite.id, inviteUrl: `${new URL('/', request.url).origin}/auth/github/start?invite=${encodeURIComponent(rawToken)}`, expiresAt: invite.expiresAt }, 201)
}

async function createRegistrationCode(env: Env, user: AuthenticatedUser): Promise<Response> {
  const rawCode = crypto.randomUUID() + '-' + crypto.randomUUID().slice(0, 8)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO registration_codes (id, user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, await hashControlToken(rawCode), expiresAt, new Date().toISOString()).run()
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'server.registration_code.created', JSON.stringify({ expiresAt }), new Date().toISOString()).run()
  return json({ code: rawCode, expiresAt }, 201)
}

async function connectServer(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
  const serverId = url.searchParams.get('serverId')
  if (!serverId) return json({ error: 'serverId is required' }, 400)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Missing control token' }, 401)
  const tokenHash = await hashControlToken(token)
  const server = await env.DB.prepare('SELECT id FROM servers WHERE id = ? AND token_hash = ?').bind(serverId, tokenHash).first<{ id: string }>()
  if (!server) return json({ error: 'Invalid control token' }, 401)
  const id = env.PLUGIN_BRIDGE.idFromName(serverId)
  const bridge = env.PLUGIN_BRIDGE.get(id)
  const bridgeUrl = new URL('/connect', request.url)
  bridgeUrl.searchParams.set('serverId', serverId)
  return bridge.fetch(new Request(bridgeUrl, request))
}

async function registerServer(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => null) as { code?: string; name?: string } | null
  if (!body?.code || !body.name?.trim()) return json({ error: 'code and name are required' }, 400)
  const codeHash = await hashControlToken(body.code)
  const registration = await env.DB.prepare('SELECT id, user_id FROM registration_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(codeHash, new Date().toISOString()).first<{ id: string; user_id: string }>()
  if (!registration) return json({ error: 'Registration code is invalid or expired' }, 401)
  const serverId = crypto.randomUUID()
  const accessToken = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('UPDATE registration_codes SET used_at = ? WHERE id = ?').bind(new Date().toISOString(), registration.id),
    env.DB.prepare('INSERT INTO servers (id, user_id, name, token_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(serverId, registration.user_id, body.name.trim(), await hashControlToken(accessToken), 'offline', new Date().toISOString()),
    env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), registration.user_id, 'server.registered', JSON.stringify({ serverId }), new Date().toISOString()),
  ])
  return json({ serverId, accessToken, protocolVersion: 1 }, 201)
}

async function proxyPublicHost(request: Request, env: Env, url: URL): Promise<Response> {
  const suffix = env.PLUGIN_DOMAIN_SUFFIX ?? '.plugins.example.com'
  if (!url.hostname.endsWith(suffix)) return new Response('Plugmesh console route', { status: 404 })
  const hostname = url.hostname
  const domain = await env.DB.prepare('SELECT plugin_instance_id, server_id, status FROM domains JOIN plugin_instances ON plugin_instances.id = domains.plugin_instance_id WHERE hostname = ?').bind(hostname).first<{ plugin_instance_id: string; server_id: string; status: string }>()
  if (!domain || domain.status !== 'online') return new Response('<!doctype html><title>维护中</title><main style="font-family:system-ui;padding:48px"><h1>插件暂时不可用</h1><p>公开入口尚未就绪或插件服务器当前离线。</p></main>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(domain.plugin_instance_id))
  const headers = new Headers(request.headers)
  headers.set('x-plugmesh-server-id', domain.server_id)
  return bridge.fetch(new Request(new URL('/proxy', request.url), { method: request.method, headers, body: request.body }))
}

export function createRegistrationFrame(serverId: string) {
  return makeFrame('server.register', serverId, { capabilities: ['http', 'websocket', 'sse', 'fileStream'] })
}

export function isValidControlMessage(raw: string) {
  return parseControlFrame(raw) !== null
}
