import { PluginBridge } from './durable-object'
import { hashControlToken } from './security'
import { createSession, digest, exchangeGithubCode, getCurrentUser, isAllowlisted, redirectWithError, sessionCookie, clearSessionCookie } from './auth'
import type { AuthenticatedUser, Env } from './types'
import { decryptSecret, encryptSecret } from './secrets'
import { isEmail, parseSmtpSettings, publicSmtpSettings, sendSmtpTest, type SmtpSettings } from './email'
import { discoverCloudflareAccountId, exchangeCloudflareCode, readCloudflareCredential, revokeCloudflareToken, type CloudflareCredential } from './cloudflare-oauth'
import { activateMaintenance, countStream, defaultPlatformSettings, getPlatformSettings, isMaintenanceMode, releaseR2Usage, reserveR2Usage, reserveRequest } from './usage'

export { PluginBridge }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return json({ ok: true, service: 'plugmesh-worker', protocolVersion: 1 })
    if (url.pathname === '/auth/github/start') return startGithubAuth(request, env, url)
    if (url.pathname === '/auth/github/callback') return finishGithubAuth(request, env, url)
    if (url.pathname === '/auth/cloudflare/start') return startCloudflareAuth(request, env, url)
    if (url.pathname === '/auth/cloudflare/callback') return finishCloudflareAuth(request, env, url)
    if (url.pathname === '/auth/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearSessionCookie(url.protocol === 'https:') } })
    if (url.pathname === '/control/register') return request.headers.get('Upgrade')?.toLowerCase() === 'websocket' ? registerServerSocket(request, env) : registerServer(request, env)
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
  if (request.method === 'GET' && url.pathname === '/api/plugins') return json(await env.DB.prepare('SELECT plugin_instances.id, plugin_instances.plugin_id, plugin_instances.name, plugin_instances.version, plugin_instances.state, plugin_instances.desired_state, plugin_instances.server_id, servers.name AS server_name, domains.hostname AS domain_hostname, plugin_instances.manifest_json, plugin_instances.updated_at FROM plugin_instances JOIN servers ON servers.id = plugin_instances.server_id LEFT JOIN domains ON domains.plugin_instance_id = plugin_instances.id WHERE plugin_instances.user_id = ? ORDER BY plugin_instances.updated_at DESC').bind(user.id).all())
  if (request.method === 'GET' && url.pathname === '/api/domains') return json(await env.DB.prepare('SELECT domains.id, domains.hostname, domains.status, domains.plugin_instance_id, plugin_instances.name AS plugin_name, domains.created_at FROM domains JOIN plugin_instances ON plugin_instances.id = domains.plugin_instance_id WHERE domains.user_id = ? ORDER BY domains.created_at DESC').bind(user.id).all())
  if (request.method === 'GET' && url.pathname === '/api/audit') {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
    return json(await env.DB.prepare('SELECT id, action, detail_json, created_at FROM audit_log WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 100').bind(user.id, since).all())
  }
  if (url.pathname === '/api/settings/platform') return platformSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/cloudflare') return cloudflareSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/smtp') return smtpSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/smtp/test') return smtpTestApi(request, env, user)
  if (url.pathname === '/api/usage/cloudflare') return cloudflareUsageApi(env, user)
  if (url.pathname === '/api/usage/local') return localUsageApi(env, user)
  const pluginAction = url.pathname.match(/^\/api\/plugins\/([^/]+)\/(load|unload|enable|disable|reload)$/)
  if (request.method === 'POST' && pluginAction) return commandPlugin(request, env, user, decodeURIComponent(pluginAction[1]), pluginAction[2] as 'load' | 'unload' | 'enable' | 'disable' | 'reload')
  if (request.method === 'POST' && url.pathname === '/api/domains') return assignDomain(request, env, user)
  if (request.method === 'GET' && url.pathname === '/api/invites') {
    if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
    await expireInvites(env)
    return json(await env.DB.prepare('SELECT id, email, github_login, status, expires_at, used_at, created_at FROM invites ORDER BY created_at DESC').all())
  }
  const inviteAction = url.pathname.match(/^\/api\/invites\/([^/]+)$/)
  if (request.method === 'DELETE' && inviteAction) return revokeInvite(env, user, decodeURIComponent(inviteAction[1]))
  if (request.method === 'POST' && url.pathname === '/api/invites') return createInvite(request, env, user)
  if (request.method === 'POST' && url.pathname === '/api/registration-codes') return createRegistrationCode(env, user)
  if (request.method === 'POST' && url.pathname === '/api/blobs') return createBlob(request, env)
  return json({ error: 'Not found' }, 404)
}

async function createBlob(request: Request, env: Env): Promise<Response> {
  const settings = await getPlatformSettings(env)
  if (settings.maintenance) return json({ error: 'Platform is in maintenance mode' }, 503)
  if (!await reserveRequest(env, settings.quotas)) {
    await activateMaintenance(env)
    return json({ error: 'Platform quota reached' }, 503)
  }
  await cleanupExpiredBlobs(env)
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  const maxBytes = 50 * 1024 * 1024
  if (!request.body) return json({ error: 'Request body is required' }, 400)
  if (contentLength > maxBytes) return json({ error: 'File is too large' }, 413)
  const objectKey = `temp/${crypto.randomUUID()}`
  const token = crypto.randomUUID() + crypto.randomUUID()
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream'
  const counter = { bytes: 0 }
  try {
    await env.BLOB_BUCKET.put(objectKey, countStream(request.body, counter, maxBytes), { httpMetadata: { contentType } })
  } catch {
    await env.BLOB_BUCKET.delete(objectKey)
    return json({ error: counter.bytes > maxBytes ? 'File is too large' : 'File upload failed' }, counter.bytes > maxBytes ? 413 : 502)
  }
  const sizeBytes = counter.bytes
  if (!await reserveR2Usage(env, settings.quotas, sizeBytes)) {
    await env.BLOB_BUCKET.delete(objectKey)
    await activateMaintenance(env)
    return json({ error: 'Platform quota reached' }, 503)
  }
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  try {
    await env.DB.prepare('INSERT INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), objectKey, await digest(token), contentType, sizeBytes, expiresAt, new Date().toISOString()).run()
  } catch {
    await env.BLOB_BUCKET.delete(objectKey)
    await releaseR2Usage(env, sizeBytes)
    return json({ error: 'File metadata could not be saved' }, 502)
  }
  return json({ url: `/blobs/${encodeURIComponent(token)}`, expiresAt }, 201)
}

async function consumeBlob(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const token = decodeURIComponent(url.pathname.slice('/blobs/'.length))
  if (!token) return new Response('Not found', { status: 404 })
  const object = await env.DB.prepare('SELECT id, object_key, content_type, size_bytes, expires_at FROM temp_objects WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?').bind(await digest(token), new Date().toISOString()).first<{ id: string; object_key: string; content_type: string; size_bytes: number; expires_at: string }>()
  if (!object) return new Response('Resource expired or already consumed', { status: 410 })
  const consumed = await env.DB.prepare('UPDATE temp_objects SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(new Date().toISOString(), object.id).run()
  if ((consumed.meta.changes ?? 0) !== 1) return new Response('Resource expired or already consumed', { status: 410 })
  const blob = await env.BLOB_BUCKET.get(object.object_key)
  ctx.waitUntil(releaseR2Usage(env, object.size_bytes))
  if (!blob) return new Response('Resource not found', { status: 404 })
  ctx.waitUntil(env.BLOB_BUCKET.delete(object.object_key))
  return new Response(blob.body, { headers: { 'content-type': object.content_type, 'content-length': String(blob.size), 'cache-control': 'no-store' } })
}

async function cleanupExpiredBlobs(env: Env): Promise<void> {
  const now = new Date().toISOString()
  const expired = await env.DB.prepare('SELECT id, object_key, size_bytes FROM temp_objects WHERE consumed_at IS NULL AND expires_at <= ? LIMIT 100').bind(now).all<{ id: string; object_key: string; size_bytes: number }>()
  for (const object of expired.results) {
    await env.BLOB_BUCKET.delete(object.object_key)
    await env.DB.prepare('UPDATE temp_objects SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(now, object.id).run()
    await releaseR2Usage(env, object.size_bytes)
  }
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

async function startCloudflareAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getCurrentUser(request, env)
  if (!user) return json({ error: 'Authentication required' }, 401)
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID || !env.CLOUDFLARE_OAUTH_REDIRECT_URI) return json({ error: 'Cloudflare OAuth is not configured' }, 503)
  const state = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.prepare('INSERT INTO cloudflare_oauth_states (state_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(await digest(state), user.id, new Date(Date.now() + 10 * 60 * 1000).toISOString(), new Date().toISOString()).run()
  const authorizeUrl = new URL('https://dash.cloudflare.com/oauth2/auth')
  authorizeUrl.searchParams.set('client_id', env.CLOUDFLARE_OAUTH_CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', env.CLOUDFLARE_OAUTH_REDIRECT_URI)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', env.CLOUDFLARE_OAUTH_SCOPE ?? 'workers-platform.read workers-platform.write')
  authorizeUrl.searchParams.set('state', state)
  return new Response(null, { status: 302, headers: { location: authorizeUrl.toString(), 'referrer-policy': 'no-referrer' } })
}

async function finishCloudflareAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getCurrentUser(request, env)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')
  if (!user || user.role !== 'super_admin') return redirectWithError(request, '需要超级管理员会话才能完成 Cloudflare 授权')
  if (oauthError || !state || !code) return redirectWithCloudflareError(request, 'Cloudflare 授权未完成')
  const stateRow = await env.DB.prepare('SELECT state_hash, user_id FROM cloudflare_oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at > ?').bind(await digest(state), user.id, new Date().toISOString()).first<{ state_hash: string; user_id: string }>()
  if (!stateRow) return redirectWithCloudflareError(request, 'Cloudflare OAuth 状态已过期或已使用')
  await env.DB.prepare('DELETE FROM cloudflare_oauth_states WHERE state_hash = ?').bind(stateRow.state_hash).run()
  const credential = await exchangeCloudflareCode(env, code)
  if (!credential) {
    await recordAudit(env, user.id, 'cloudflare.oauth.failed', {})
    return redirectWithCloudflareError(request, 'Cloudflare OAuth 令牌交换失败')
  }
  if (!credential.accountId) credential.accountId = await discoverCloudflareAccountId(credential.accessToken)
  if (!env.SESSION_SECRET) return redirectWithCloudflareError(request, 'SESSION_SECRET 未配置，无法保存 Cloudflare 凭据')
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify(credential))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  await recordAudit(env, user.id, 'cloudflare.oauth.connected', { accountIdConfigured: Boolean(credential.accountId) })
  return redirectWithCloudflareResult(request, Boolean(credential.accountId))
}

function redirectWithCloudflareResult(request: Request, accountConfigured: boolean): Response {
  const location = new URL('/', request.url)
  location.searchParams.set('cloudflare', accountConfigured ? 'connected' : 'connected_without_account')
  return new Response(null, { status: 302, headers: { location: location.toString(), 'referrer-policy': 'no-referrer' } })
}

function redirectWithCloudflareError(request: Request, message: string): Response {
  const location = new URL('/', request.url)
  location.searchParams.set('cloudflare_error', message)
  return new Response(null, { status: 302, headers: { location: location.toString(), 'referrer-policy': 'no-referrer' } })
}

async function recordAudit(env: Env, userId: string, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, action, JSON.stringify(detail), new Date().toISOString()).run()
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

async function expireInvites(env: Env): Promise<void> {
  await env.DB.prepare('UPDATE invites SET status = ? WHERE status = ? AND expires_at <= ?').bind('expired', 'pending', new Date().toISOString()).run()
}

async function revokeInvite(env: Env, user: AuthenticatedUser, inviteId: string): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  await expireInvites(env)
  const updated = await env.DB.prepare('UPDATE invites SET status = ? WHERE id = ? AND status = ?').bind('revoked', inviteId, 'pending').run()
  if ((updated.meta.changes ?? 0) !== 1) return json({ error: 'Invite is not pending or does not exist' }, 409)
  await recordAudit(env, user.id, 'invite.revoked', { inviteId })
  return json({ id: inviteId, status: 'revoked' })
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
  const plugin = await env.DB.prepare('SELECT id, plugin_id, server_id, state, desired_state FROM plugin_instances WHERE id = ? AND user_id = ?').bind(pluginInstanceId, user.id).first<{ id: string; plugin_id: string; server_id: string; state: string; desired_state: string }>()
  if (!plugin) return json({ error: 'Plugin instance not found' }, 404)
  const server = await env.DB.prepare('SELECT status FROM servers WHERE id = ? AND user_id = ?').bind(plugin.server_id, user.id).first<{ status: string }>()
  if (!server || server.status !== 'online') return json({ error: 'Plugin server is offline' }, 409)
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(plugin.server_id))
  const response = await bridge.fetch(new Request(new URL('/command', request.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-plugmesh-server-id': plugin.server_id }, body: JSON.stringify({ type: `plugin.${action}`, pluginId: plugin.plugin_id }) }))
  if (!response.ok) return response
  const result = await response.json().catch(() => null) as { state?: string } | null
  const nextState = result?.state ?? (action === 'load' ? 'loaded' : action === 'unload' ? 'unloaded' : action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : plugin.state)
  const nextDesiredState = action === 'reload' ? plugin.desired_state : action === 'load' ? 'loaded' : action === 'unload' ? 'unloaded' : action === 'enable' ? 'enabled' : 'disabled'
  await env.DB.prepare('UPDATE plugin_instances SET state = ?, desired_state = ?, updated_at = ? WHERE id = ?').bind(nextState, nextDesiredState, new Date().toISOString(), plugin.id).run()
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
  const suffix = pluginDomainSuffix(env)
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
  const result = await createServerRegistration(env, body?.code, body?.name)
  if ('error' in result) return json({ error: result.error }, result.status)
  return json(result.value, 201)
}

function registerServerSocket(request: Request, env: Env): Response {
  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  let handled = false
  server.accept()
  server.addEventListener('message', (event) => {
    if (handled || typeof event.data !== 'string' || event.data.length > 8192) return
    handled = true
    void (async () => {
      let body: { code?: string; name?: string } | null = null
      try {
        body = JSON.parse(event.data) as { code?: string; name?: string }
      } catch {
        server.send(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
        server.close(1003, 'Invalid JSON')
        return
      }
      const result = await createServerRegistration(env, body.code, body.name)
      if ('error' in result) server.send(JSON.stringify({ ok: false, error: result.error }))
      else server.send(JSON.stringify({ ok: true, ...result.value }))
      server.close(1000, 'Registration complete')
    })()
  })
  return new Response(null, { status: 101, webSocket: client })
}

async function createServerRegistration(env: Env, code: string | undefined, name: string | undefined): Promise<{ value: { serverId: string; accessToken: string; protocolVersion: number } } | { error: string; status: number }> {
  if (!code || !name?.trim()) return { error: 'code and name are required', status: 400 }
  const codeHash = await hashControlToken(code)
  const registration = await env.DB.prepare('SELECT id, user_id FROM registration_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(codeHash, new Date().toISOString()).first<{ id: string; user_id: string }>()
  if (!registration) return { error: 'Registration code is invalid or expired', status: 401 }
  const marked = await env.DB.prepare('UPDATE registration_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?').bind(new Date().toISOString(), registration.id, new Date().toISOString()).run()
  if ((marked.meta.changes ?? 0) !== 1) return { error: 'Registration code is invalid or expired', status: 401 }
  const serverId = crypto.randomUUID()
  const accessToken = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO servers (id, user_id, name, token_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(serverId, registration.user_id, name.trim(), await hashControlToken(accessToken), 'offline', new Date().toISOString()),
    env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), registration.user_id, 'server.registered', JSON.stringify({ serverId }), new Date().toISOString()),
  ])
  return { value: { serverId, accessToken, protocolVersion: 1 } }
}

async function proxyPublicHost(request: Request, env: Env, url: URL): Promise<Response> {
  const settings = await getPlatformSettings(env)
  if (settings.maintenance) return maintenanceResponse()
  const suffix = pluginDomainSuffix(env)
  if (!url.hostname.endsWith(suffix) || url.hostname.length <= suffix.length) return new Response('Plugmesh console route', { status: 404 })
  const prefix = url.hostname.slice(0, -suffix.length)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(prefix)) return new Response('Plugmesh console route', { status: 404 })
  const hostname = url.hostname
  const domain = await env.DB.prepare('SELECT domains.plugin_instance_id, domains.server_id, domains.status, plugin_instances.plugin_id, servers.status AS server_status FROM domains JOIN plugin_instances ON plugin_instances.id = domains.plugin_instance_id JOIN servers ON servers.id = plugin_instances.server_id WHERE domains.hostname = ?').bind(hostname).first<{ plugin_instance_id: string; server_id: string; status: string; plugin_id: string; server_status: string }>()
  if (!domain || domain.status !== 'online' || domain.server_status !== 'online') return maintenanceResponse('插件暂时不可用', '公开入口尚未就绪或插件服务器当前离线。')
  if (!await reserveRequest(env, settings.quotas)) {
    await activateMaintenance(env)
    return maintenanceResponse()
  }
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(domain.server_id))
  const headers = new Headers(request.headers)
  headers.set('x-plugmesh-server-id', domain.server_id)
  headers.set('x-plugmesh-plugin-id', domain.plugin_id)
  headers.set('x-plugmesh-request-path', url.pathname + url.search)
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return bridge.fetch(new Request(new URL('/websocket', request.url), { method: 'GET', headers }))
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

async function cloudflareSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const existing = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string; updated_at: string }>()
  if (request.method === 'GET') {
    const credential = existing ? await readCloudflareCredential(env, existing.ciphertext, existing.iv) : null
    return json({ configured: Boolean(credential), accountIdConfigured: Boolean(credential?.accountId), accountId: maskAccountId(credential?.accountId), updatedAt: existing?.updated_at ?? null })
  }
  if (request.method === 'DELETE') {
    if (existing) {
      const credential = await readCloudflareCredential(env, existing.ciphertext, existing.iv)
      if (credential) await revokeCloudflareToken(env, credential.accessToken)
    }
    await env.DB.prepare('DELETE FROM cloudflare_credentials WHERE id = ?').bind('primary').run()
    await recordAudit(env, user.id, 'cloudflare.credentials.revoked', {})
    return json({ configured: false, accountIdConfigured: false, accountId: null, updatedAt: null })
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const body = await request.json().catch(() => null) as { accessToken?: string; accountId?: string } | null
  if (!body?.accessToken?.trim()) return json({ error: 'accessToken is required' }, 400)
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify({ accessToken: body.accessToken.trim(), accountId: body.accountId?.trim() || null, tokenType: 'Bearer', expiresAt: null } satisfies CloudflareCredential))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  await recordAudit(env, user.id, 'cloudflare.credentials.updated', { accountIdConfigured: Boolean(body.accountId?.trim()) })
  return json({ configured: true, accountIdConfigured: Boolean(body.accountId?.trim()), accountId: maskAccountId(body.accountId?.trim() || null), updatedAt })
}

function maskAccountId(accountId: string | null | undefined): string | null {
  if (!accountId) return null
  return accountId.length <= 8 ? '已配置' : `${accountId.slice(0, 4)}...${accountId.slice(-4)}`
}

async function smtpSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const existing = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM smtp_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string; updated_at: string }>()
  if (request.method === 'GET') {
    if (!existing || !env.SESSION_SECRET) return json({ configured: false, updatedAt: existing?.updated_at ?? null })
    try {
      const settings = parseSmtpSettings(JSON.parse(await decryptSecret(env.SESSION_SECRET, existing.ciphertext, existing.iv)))
      return settings ? json(publicSmtpSettings(settings, existing.updated_at)) : json({ configured: false, updatedAt: existing.updated_at })
    } catch {
      return json({ configured: false, updatedAt: existing.updated_at })
    }
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM smtp_settings WHERE id = ?').bind('primary').run()
    await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'smtp.settings.revoked', '{}', new Date().toISOString()).run()
    return json({ configured: false, updatedAt: null })
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const settings = parseSmtpSettings(await request.json().catch(() => null))
  if (!settings) return json({ error: 'Invalid SMTP settings' }, 400)
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify(settings))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO smtp_settings (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'smtp.settings.updated', JSON.stringify({ host: settings.host, port: settings.port, secure: settings.secure, username: settings.username, authType: settings.authType, from: settings.from }), updatedAt).run()
  return json(publicSmtpSettings(settings, updatedAt))
}

async function smtpTestApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const body = await request.json().catch(() => null) as { to?: string } | null
  if (!body?.to || !isEmail(body.to)) return json({ error: 'A valid test recipient is required' }, 400)
  const stored = await env.DB.prepare('SELECT ciphertext, iv FROM smtp_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  if (!stored) return json({ error: 'SMTP is not configured' }, 409)
  let settings: SmtpSettings | null = null
  try {
    settings = parseSmtpSettings(JSON.parse(await decryptSecret(env.SESSION_SECRET, stored.ciphertext, stored.iv)))
  } catch {
    return json({ error: 'SMTP credential decryption failed' }, 500)
  }
  if (!settings) return json({ error: 'SMTP settings are invalid' }, 500)
  const maxAttempts = 3
  let lastError = 'unknown SMTP error'
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sendSmtpTest(settings, body.to)
      await recordAudit(env, user.id, 'smtp.test.sent', { to: body.to, attempts: attempt })
      return json({ sent: true, attempts: attempt })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < maxAttempts) await wait(250 * 2 ** (attempt - 1))
    }
  }
  await recordAudit(env, user.id, 'smtp.test.failed', { to: body.to, attempts: maxAttempts, error: redactSmtpError(lastError, settings.password) })
  return json({ error: 'SMTP test send failed', attempts: maxAttempts }, 502)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function redactSmtpError(message: string, password: string): string {
  return message.replaceAll(password, '[REDACTED]').slice(0, 256)
}

async function cloudflareUsageApi(env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const cached = await env.DB.prepare('SELECT value_json, expires_at, updated_at FROM usage_cache WHERE key = ? AND expires_at > ?').bind('cloudflare:workers', new Date().toISOString()).first<{ value_json: string; expires_at: string; updated_at: string }>()
  if (cached) return json({ ...JSON.parse(cached.value_json), cached: true, updatedAt: cached.updated_at })
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const credentials = await env.DB.prepare('SELECT ciphertext, iv FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  if (!credentials) return json({ configured: false, cached: false })
  let accountId: string | null = null
  let accessToken = ''
  try {
    const value = JSON.parse(await decryptSecret(env.SESSION_SECRET, credentials.ciphertext, credentials.iv)) as { accessToken?: string; accountId?: string | null }
    accessToken = value.accessToken ?? ''
    accountId = value.accountId ?? null
  } catch {
    return json({ error: 'Cloudflare credential decryption failed' }, 500)
  }
  if (!accessToken || !accountId) return json({ configured: true, accountIdConfigured: Boolean(accountId), cached: false })
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `query Usage($accountTag: String!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } } } } }`, variables: { accountTag: accountId, start: start.toISOString(), end: end.toISOString() } }),
  })
  if (!response.ok) return json({ error: 'Cloudflare Analytics request failed', status: response.status }, 502)
  const payload = await response.json() as { errors?: unknown[]; data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: Array<{ sum?: { requests?: number } }> }> } } }
  if (payload.errors?.length) return json({ error: 'Cloudflare Analytics returned errors', details: payload.errors }, 502)
  const requests = payload.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests ?? 0
  const result = { configured: true, accountIdConfigured: true, period: { start: start.toISOString(), end: end.toISOString() }, requests, source: 'cloudflare_graphql' }
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO usage_cache (key, value_json, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at, updated_at = excluded.updated_at').bind('cloudflare:workers', JSON.stringify(result), new Date(Date.now() + 5 * 60 * 1000).toISOString(), updatedAt).run()
  return json({ ...result, cached: false, updatedAt })
}

async function localUsageApi(env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const usage = await env.DB.prepare('SELECT request_count, request_window_started_at, active_connections, r2_bytes, r2_objects, updated_at FROM platform_usage WHERE key = ?').bind('global').first<{ request_count: number; request_window_started_at: string; active_connections: number; r2_bytes: number; r2_objects: number; updated_at: string }>()
  return json({
    requestCount: usage?.request_count ?? 0,
    requestWindowStartedAt: usage?.request_window_started_at ?? null,
    activeConnections: usage?.active_connections ?? 0,
    r2Bytes: usage?.r2_bytes ?? 0,
    r2Objects: usage?.r2_objects ?? 0,
    updatedAt: usage?.updated_at ?? null,
  })
}

function maintenanceResponse(title = '平台维护中', detail = '平台当前暂停新流量，请稍后再试。'): Response {
  return new Response(`<!doctype html><title>${title}</title><main style="font-family:system-ui;padding:48px"><h1>${title}</h1><p>${detail}</p></main>`, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '300' } })
}

function pluginDomainSuffix(env: Env): string {
  const configured = (env.PLUGIN_DOMAIN_SUFFIX ?? '.plugins.example.com').trim().toLowerCase()
  const suffix = configured.startsWith('.') ? configured : `.${configured}`
  return /^\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(suffix) && !suffix.includes('..') ? suffix : '.plugins.example.com'
}

