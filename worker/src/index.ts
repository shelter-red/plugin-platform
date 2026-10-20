import { PluginBridge } from './durable-object'
import { hashControlToken } from './security'
import { createSession, digest, exchangeGithubCode, getCurrentUser, isAllowlisted, redirectWithError, sessionCookie, clearSessionCookie } from './auth'
import type { AuthenticatedUser, Env } from './types'

export { PluginBridge }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const defaultPlatformSettings = { maintenance: false, quotas: { requests: 100000, activeConnections: 100, r2Bytes: 10 * 1024 * 1024 * 1024, r2Objects: 1000 } }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return json({ ok: true, service: 'plugmesh-worker', protocolVersion: 1 })
    if (url.pathname === '/auth/github/start') return startGithubAuth(request, env, url)
    if (url.pathname === '/auth/github/callback') return finishGithubAuth(request, env, url)
    if (url.pathname === '/auth/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearSessionCookie(url.protocol === 'https:') } })
    if (url.pathname === '/control/register') return registerServer(request, env)
    if (url.pathname.startsWith('/api/')) return api(request, env, url)
    if (url.pathname === '/control/connect') return connectServer(request, env, url)
    if (url.pathname.startsWith('/blobs/')) return consumeBlob(request, env, ctx, url)
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
  if (url.pathname === '/api/settings/platform') return platformSettingsApi(request, env, user)
  const pluginAction = url.pathname.match(/^\/api\/plugins\/([^/]+)\/(load|unload|enable|disable|reload)$/)
  if (request.method === 'POST' && pluginAction) return commandPlugin(request, env, user, decodeURIComponent(pluginAction[1]), pluginAction[2] as 'load' | 'unload' | 'enable' | 'disable' | 'reload')
  if (request.method === 'POST' && url.pathname === '/api/domains') return assignDomain(request, env, user)
  if (request.method === 'GET' && url.pathname === '/api/invites') {
    if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
    return json(await env.DB.prepare('SELECT id, email, github_login, status, expires_at, used_at, created_at FROM invites ORDER BY created_at DESC').all())
  }
  if (request.method === 'POST' && url.pathname === '/api/invites') return createInvite(request, env, user)
  if (request.method === 'POST' && url.pathname === '/api/registration-codes') return createRegistrationCode(env, user)
  if (request.method === 'POST' && url.pathname === '/api/blobs') return createBlob(request, env)
  return json({ error: 'Not found' }, 404)
}

async function createBlob(request: Request, env: Env): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  const maxBytes = 50 * 1024 * 1024
  if (!request.body) return json({ error: 'Request body is required' }, 400)
  if (contentLength > maxBytes) return json({ error: 'File is too large' }, 413)
  const objectKey = `temp/${crypto.randomUUID()}`
  const token = crypto.randomUUID() + crypto.randomUUID()
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream'
  const sizeBytes = contentLength || 0
  await env.BLOB_BUCKET.put(objectKey, request.body, { httpMetadata: { contentType } })
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), objectKey, await digest(token), contentType, sizeBytes, expiresAt, new Date().toISOString()).run()
  return json({ url: `/blobs/${encodeURIComponent(token)}`, expiresAt }, 201)
}

async function consumeBlob(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const token = decodeURIComponent(url.pathname.slice('/blobs/'.length))
  if (!token) return new Response('Not found', { status: 404 })
  const object = await env.DB.prepare('SELECT id, object_key, content_type, expires_at FROM temp_objects WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?').bind(await digest(token), new Date().toISOString()).first<{ id: string; object_key: string; content_type: string; expires_at: string }>()
  if (!object) return new Response('Resource expired or already consumed', { status: 410 })
  const blob = await env.BLOB_BUCKET.get(object.object_key)
  if (!blob) return new Response('Resource not found', { status: 404 })
  await env.DB.prepare('UPDATE temp_objects SET consumed_at = ? WHERE id = ?').bind(new Date().toISOString(), object.id).run()
  ctx.waitUntil(env.BLOB_BUCKET.delete(object.object_key))
  return new Response(blob.body, { headers: { 'content-type': object.content_type, 'content-length': String(blob.size), 'cache-control': 'no-store' } })
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
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const rawCode = crypto.randomUUID() + '-' + crypto.randomUUID().slice(0, 8)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO registration_codes (id, user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, await hashControlToken(rawCode), expiresAt, new Date().toISOString()).run()
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'server.registration_code.created', JSON.stringify({ expiresAt }), new Date().toISOString()).run()
  return json({ code: rawCode, expiresAt }, 201)
}

async function commandPlugin(request: Request, env: Env, user: AuthenticatedUser, pluginInstanceId: string, action: 'load' | 'unload' | 'enable' | 'disable' | 'reload'): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const plugin = await env.DB.prepare('SELECT id, plugin_id, server_id, state FROM plugin_instances WHERE id = ? AND user_id = ?').bind(pluginInstanceId, user.id).first<{ id: string; plugin_id: string; server_id: string; state: string }>()
  if (!plugin) return json({ error: 'Plugin instance not found' }, 404)
  const server = await env.DB.prepare('SELECT status FROM servers WHERE id = ? AND user_id = ?').bind(plugin.server_id, user.id).first<{ status: string }>()
  if (!server || server.status !== 'online') return json({ error: 'Plugin server is offline' }, 409)
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(plugin.server_id))
  const response = await bridge.fetch(new Request(new URL('/command', request.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-plugmesh-server-id': plugin.server_id }, body: JSON.stringify({ type: `plugin.${action}`, pluginId: plugin.plugin_id }) }))
  if (!response.ok) return response
  const nextState = action === 'load' ? 'loaded' : action === 'unload' ? 'unloaded' : action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : plugin.state
  await env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE id = ?').bind(nextState, new Date().toISOString(), plugin.id).run()
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, `plugin.${action}`, JSON.stringify({ pluginInstanceId: plugin.id }), new Date().toISOString()).run()
  return json({ id: plugin.id, state: nextState, accepted: true }, 202)
}

async function assignDomain(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const body = await request.json().catch(() => null) as { pluginInstanceId?: string; prefix?: string } | null
  const prefix = body?.prefix?.trim().toLowerCase() ?? ''
  const reserved = new Set(['admin', 'api', 'auth', 'console', 'control', 'plugins', 'www'])
  if (!body?.pluginInstanceId || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(prefix) || reserved.has(prefix)) return json({ error: 'Invalid domain prefix' }, 400)
  const plugin = await env.DB.prepare('SELECT id, server_id, state FROM plugin_instances WHERE id = ? AND user_id = ?').bind(body.pluginInstanceId, user.id).first<{ id: string; server_id: string; state: string }>()
  if (!plugin) return json({ error: 'Plugin instance not found' }, 404)
  if (plugin.state !== 'enabled') return json({ error: 'Plugin must be enabled before assigning a domain' }, 409)
  const suffix = env.PLUGIN_DOMAIN_SUFFIX ?? '.plugins.example.com'
  const hostname = `${prefix}${suffix}`
  const server = await env.DB.prepare('SELECT status FROM servers WHERE id = ? AND user_id = ?').bind(plugin.server_id, user.id).first<{ status: string }>()
  if (!server || server.status !== 'online') return json({ error: 'Plugin server is offline' }, 409)
  try {
    await env.DB.prepare('INSERT INTO domains (id, user_id, plugin_instance_id, hostname, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, plugin.id, hostname, 'online', new Date().toISOString()).run()
  } catch {
    return json({ error: 'Domain is already assigned' }, 409)
  }
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'domain.assigned', JSON.stringify({ pluginInstanceId: plugin.id, hostname }), new Date().toISOString()).run()
  return json({ hostname, status: 'online' }, 201)
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
  if (await isMaintenanceMode(env)) return maintenanceResponse()
  const suffix = env.PLUGIN_DOMAIN_SUFFIX ?? '.plugins.example.com'
  if (!url.hostname.endsWith(suffix)) return new Response('Plugmesh console route', { status: 404 })
  const hostname = url.hostname
  const domain = await env.DB.prepare('SELECT domains.plugin_instance_id, domains.server_id, domains.status, servers.status AS server_status FROM domains JOIN plugin_instances ON plugin_instances.id = domains.plugin_instance_id JOIN servers ON servers.id = plugin_instances.server_id WHERE domains.hostname = ?').bind(hostname).first<{ plugin_instance_id: string; server_id: string; status: string; server_status: string }>()
  if (!domain || domain.status !== 'online' || domain.server_status !== 'online') return maintenanceResponse('插件暂时不可用', '公开入口尚未就绪或插件服务器当前离线。')
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(domain.plugin_instance_id))
  const headers = new Headers(request.headers)
  headers.set('x-plugmesh-server-id', domain.server_id)
  return bridge.fetch(new Request(new URL('/proxy', request.url), { method: request.method, headers, body: request.body }))
}

async function platformSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const settings = await getPlatformSettings(env)
  if (request.method === 'GET') return json(settings)
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => null) as { maintenance?: boolean; quotas?: Partial<typeof defaultPlatformSettings.quotas> } | null
  const next = {
    maintenance: Boolean(body?.maintenance ?? settings.maintenance),
    quotas: {
      requests: Math.max(1, Number(body?.quotas?.requests ?? settings.quotas.requests)),
      activeConnections: Math.max(1, Number(body?.quotas?.activeConnections ?? settings.quotas.activeConnections)),
      r2Bytes: Math.max(1, Number(body?.quotas?.r2Bytes ?? settings.quotas.r2Bytes)),
      r2Objects: Math.max(1, Number(body?.quotas?.r2Objects ?? settings.quotas.r2Objects)),
    },
  }
  await env.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').bind('platform', JSON.stringify(next), new Date().toISOString()).run()
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'platform.settings.updated', JSON.stringify(next), new Date().toISOString()).run()
  return json(next)
}

async function getPlatformSettings(env: Env): Promise<typeof defaultPlatformSettings> {
  const row = await env.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  if (!row) return defaultPlatformSettings
  try {
    const value = JSON.parse(row.value_json) as Partial<typeof defaultPlatformSettings>
    return { ...defaultPlatformSettings, ...value, quotas: { ...defaultPlatformSettings.quotas, ...(value.quotas ?? {}) } }
  } catch {
    return defaultPlatformSettings
  }
}

async function isMaintenanceMode(env: Env): Promise<boolean> {
  return (await getPlatformSettings(env)).maintenance
}

function maintenanceResponse(title = '平台维护中', detail = '平台当前暂停新流量，请稍后再试。'): Response {
  return new Response(`<!doctype html><title>${title}</title><main style="font-family:system-ui;padding:48px"><h1>${title}</h1><p>${detail}</p></main>`, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '300' } })
}

