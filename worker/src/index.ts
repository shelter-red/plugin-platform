import { PluginBridge } from './durable-object'
import { hashControlToken } from './security'
import { authenticatePassword, changeAdminPassword, clearSessionCookie, createSession, digest, getAdminPasswordState, getCurrentUser, MIN_PASSWORD_LENGTH, sessionCookie } from './auth'
import type { AuthenticatedUser, CloudflarePlanSummary, CloudflareUsageLimits, Env } from './types'
import { decryptSecret, encryptSecret } from './secrets'
import { isEmail, parseSmtpSettings, publicSmtpSettings, sendSmtpTest, validateSmtpSettings, type SmtpSettings } from './email'
import { CloudflareCredentialError, cloudflarePlanLimits, configureCloudflareDomain, deleteStoredCloudflareCredential, maskCloudflareAccountId, readCloudflareSubscriptions, readStoredCloudflareCredential, storeCloudflareCredential, validateCloudflareCredential } from './cloudflare-credentials'
import { activateMaintenance, cloudflareQuotaReason, defaultPlatformSettings, getPlatformSettings, isMaintenanceMode, normalizePluginDomainSuffix, recordRequest, releaseR2Usage, reserveR2Usage, setPlatformSettingsCache } from './usage'
import { findPluginRoute, invalidatePluginRoute } from './route-cache'
import { selectPublicRequestMode } from './request-mode'
import { resolvePublicRoute } from './public-route'
import { setupApi } from './setup'
import { recordAudit } from './audit'
import { DEFAULT_WORKSPACE_ID, activeWorkspaceId, createWorkspace, listWorkspaceMembers, listWorkspaces, ownerCount, parseWorkspaceRole, requireOwner, requireWrite, resolveWorkspace, workspaceForUser } from './workspaces'
import type { Workspace, WorkspaceRole } from './types'

export { PluginBridge }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
function configuredConsoleHostname(env: Env, request: Request): string {
  return env.CONSOLE_HOSTNAME?.trim().toLowerCase() || new URL(request.url).hostname.toLowerCase()
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const managementPath = url.pathname === '/setup' || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/control/') || url.pathname.startsWith('/blobs/')
    if (!managementPath && await isPluginHostname(url.hostname, env)) return proxyPublicHost(request, env, url, ctx)
    const passwordState = await getAdminPasswordState(env)
    if (url.pathname === '/api/health') {
      if (passwordState === 'migration_required') return json({ ok: false, service: 'plugmesh-worker', protocolVersion: 1, code: 'migration_required', message: 'D1 migration 尚未完成' }, 503)
      return json({ ok: true, service: 'plugmesh-worker', protocolVersion: 1 })
    }
    if (url.pathname === '/setup') {
      const setupResponse = await setupApi(request, env, passwordState)
      if (setupResponse) {
        return setupResponse
      }
    }
    if (passwordState !== 'configured' && !url.pathname.startsWith('/control/') && !url.pathname.startsWith('/blobs/')) {
      if (url.pathname.startsWith('/api/')) {
        if (passwordState === 'migration_required') return json({ code: 'migration_required', message: 'D1 migration 尚未完成，请先应用数据库迁移' }, 503)
        return json({ code: 'setup_required', message: '请先在 setup 页面设置管理员密码' }, 503)
      }
      return Response.redirect(new URL('/setup', request.url).toString(), 302)
    }
    if (url.pathname === '/auth/login') return passwordLogin(request, env, url)
    if (url.pathname === '/auth/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearSessionCookie(url.protocol === 'https:') } })
    if (url.pathname === '/control/register') return request.headers.get('Upgrade')?.toLowerCase() === 'websocket' ? registerServerSocket(env) : registerServer(request, env)
    if (url.pathname.startsWith('/api/')) return api(request, env, url)
    if (url.pathname === '/control/connect') return connectServer(request, env, url)
    if (url.pathname.startsWith('/blobs/')) return consumeBlob(request, env, ctx, url)
    return serveConsole(request, env)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledMaintenance(env))
  },
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getCurrentUser(request, env)
  if (!user) return json({ error: 'Authentication required' }, 401)
  if (url.pathname === '/api/me') {
    const workspaces = await listWorkspaces(env, user)
    const active = await activeWorkspaceId(env, request, user)
    return json({ user, workspaces, activeWorkspaceId: active })
  }
  const workspaceResponse = await workspaceApi(request, env, user, url)
  if (workspaceResponse) return workspaceResponse
  if (request.method === 'POST' && url.pathname === '/api/blobs') return createBlob(request, env)

  const resolved = await resolveWorkspace(request, env, user)
  if (!resolved.ok) return resolved.response
  const { workspace } = resolved.value
  // 平台级设置只允许全局管理员写入，其权限由各 handler 校验；工作区角色不应拦截。
  const platformWrite = user.role === 'super_admin' && url.pathname.startsWith('/api/settings/')
  const writeDenied = request.method === 'GET' || platformWrite ? null : requireWrite(workspace)
  if (writeDenied) return writeDenied

  if (request.method === 'GET' && url.pathname === '/api/overview') {
    const [servers, plugins, domains] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM servers WHERE workspace_id = ? AND status = ?').bind(workspace.id, 'online').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM plugin_instances WHERE workspace_id = ? AND state = ?').bind(workspace.id, 'enabled').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM domains WHERE workspace_id = ?').bind(workspace.id).first<{ count: number }>(),
    ])
    return json({ onlineServers: servers?.count ?? 0, enabledPlugins: plugins?.count ?? 0, domains: domains?.count ?? 0 })
  }
  if (request.method === 'GET' && url.pathname === '/api/servers') return json(await env.DB.prepare('SELECT id, name, status, last_seen_at, created_at FROM servers WHERE workspace_id = ? ORDER BY created_at DESC').bind(workspace.id).all())
  if (request.method === 'GET' && url.pathname === '/api/plugins') return json(await env.DB.prepare('SELECT plugin_instances.id, plugin_instances.plugin_id, plugin_instances.name, plugin_instances.version, plugin_instances.state, plugin_instances.desired_state, plugin_instances.server_id, servers.name AS server_name, domains.hostname AS domain_hostname, plugin_instances.manifest_json, plugin_instances.updated_at FROM plugin_instances JOIN servers ON servers.id = plugin_instances.server_id LEFT JOIN domains ON domains.plugin_instance_id = plugin_instances.id WHERE plugin_instances.workspace_id = ? ORDER BY plugin_instances.updated_at DESC').bind(workspace.id).all())
  if (request.method === 'GET' && url.pathname === '/api/domains') return json(await env.DB.prepare('SELECT domains.id, domains.hostname, domains.status, domains.plugin_instance_id, plugin_instances.name AS plugin_name, domains.created_at FROM domains JOIN plugin_instances ON plugin_instances.id = domains.plugin_instance_id WHERE domains.workspace_id = ? ORDER BY domains.created_at DESC').bind(workspace.id).all())
  if (request.method === 'GET' && url.pathname === '/api/audit') {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
    if (user.role === 'super_admin') {
      return json(await env.DB.prepare('SELECT audit_log.id, audit_log.action, audit_log.detail_json, audit_log.created_at, users.display_name AS actor_name, users.email AS actor_email FROM audit_log LEFT JOIN users ON users.id = audit_log.user_id WHERE (audit_log.workspace_id = ? OR audit_log.workspace_id IS NULL) AND audit_log.created_at >= ? ORDER BY audit_log.created_at DESC LIMIT 200').bind(workspace.id, since).all())
    }
    return json(await env.DB.prepare('SELECT audit_log.id, audit_log.action, audit_log.detail_json, audit_log.created_at, users.display_name AS actor_name, users.email AS actor_email FROM audit_log LEFT JOIN users ON users.id = audit_log.user_id WHERE audit_log.workspace_id = ? AND audit_log.created_at >= ? ORDER BY audit_log.created_at DESC LIMIT 100').bind(workspace.id, since).all())
  }
  if (request.method === 'GET' && url.pathname === '/api/access-logs') return accessLogsApi(env, workspace)
  if (url.pathname === '/api/settings/platform') return platformSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/password') return passwordSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/cloudflare') return cloudflareSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/smtp') return smtpSettingsApi(request, env, user)
  if (url.pathname === '/api/settings/smtp/test') return smtpTestApi(request, env, user)
  if (url.pathname === '/api/usage/cloudflare') return cloudflareUsageApi(env, user)
  if (url.pathname === '/api/usage/local') return localUsageApi(env, user, url, workspace)
  const serverDetail = url.pathname.match(/^\/api\/servers\/([^/]+)$/)
  const serverSync = url.pathname.match(/^\/api\/servers\/([^/]+)\/sync$/)
  if (request.method === 'POST' && serverSync) return syncServer(request, env, user, workspace, decodeURIComponent(serverSync[1]))
  if (request.method === 'GET' && serverDetail) return serverDetailsApi(env, workspace, decodeURIComponent(serverDetail[1]))
  const pluginDetail = url.pathname.match(/^\/api\/plugins\/([^/]+)$/)
  if (request.method === 'GET' && pluginDetail) return pluginDetailsApi(env, workspace, decodeURIComponent(pluginDetail[1]))
  const pluginAction = url.pathname.match(/^\/api\/plugins\/([^/]+)\/(load|unload|enable|disable|reload|health)$/)
  if (request.method === 'POST' && pluginAction) return commandPlugin(request, env, user, workspace, decodeURIComponent(pluginAction[1]), pluginAction[2] as 'load' | 'unload' | 'enable' | 'disable' | 'reload' | 'health')
  if (request.method === 'POST' && url.pathname === '/api/domains') return assignDomain(request, env, user, workspace)
  if (request.method === 'POST' && url.pathname === '/api/registration-codes') return createRegistrationCode(env, user, workspace)
  return json({ error: 'Not found' }, 404)
}

const workspaceNotFound = () => json({ error: 'Workspace not found' }, 404)
const workspaceDenied = () => json({ error: 'Workspace access denied' }, 403)
const invalidWorkspaceName = (name: unknown): boolean => typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 64

async function accessibleWorkspace(env: Env, user: AuthenticatedUser, workspaceId: string): Promise<{ workspace: Workspace } | { status: number }> {
  const exists = await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?').bind(workspaceId).first<{ id: string }>()
  if (!exists) return { status: 404 }
  const workspace = await workspaceForUser(env, user, workspaceId)
  return workspace ? { workspace } : { status: 403 }
}

async function workspaceApi(request: Request, env: Env, user: AuthenticatedUser, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/workspaces')) return null
  if (url.pathname === '/api/workspaces') {
    if (request.method === 'GET') return json({ results: await listWorkspaces(env, user) })
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const body = await request.json().catch(() => null) as { name?: string } | null
    if (invalidWorkspaceName(body?.name)) return json({ error: 'Workspace name is required' }, 400)
    const workspace = await createWorkspace(env, user, body!.name!)
    await recordAudit(env, workspace.id, user.id, 'workspace.created', { name: workspace.name, slug: workspace.slug })
    return json(workspace, 201)
  }

  const memberDetail = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/([^/]+)$/)
  if (memberDetail) {
    const access = await accessibleWorkspace(env, user, decodeURIComponent(memberDetail[1]))
    if ('status' in access) return access.status === 404 ? workspaceNotFound() : workspaceDenied()
    const denied = requireOwner(access.workspace)
    if (denied) return denied
    const userId = decodeURIComponent(memberDetail[2])
    const membership = await env.DB.prepare('SELECT user_id, role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(access.workspace.id, userId).first<{ user_id: string; role: WorkspaceRole }>()
    if (!membership) return json({ error: 'Workspace member not found' }, 404)
    if (request.method === 'DELETE') {
      if (membership.role === 'owner' && await ownerCount(env, access.workspace.id) <= 1) return json({ error: 'Cannot remove the last workspace owner' }, 409)
      await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(access.workspace.id, userId).run()
      await recordAudit(env, access.workspace.id, user.id, 'workspace.member.removed', { userId })
      return json({ userId, removed: true })
    }
    if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
    const body = await request.json().catch(() => null) as { role?: unknown } | null
    const role = parseWorkspaceRole(body?.role)
    if (!role) return json({ error: 'Workspace role is invalid' }, 400)
    if (membership.role === 'owner' && role !== 'owner' && await ownerCount(env, access.workspace.id) <= 1) return json({ error: 'Cannot demote the last workspace owner' }, 409)
    await env.DB.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').bind(role, access.workspace.id, userId).run()
    await recordAudit(env, access.workspace.id, user.id, 'workspace.member.updated', { userId, role })
    return json({ userId, role })
  }

  const members = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/)
  if (members) {
    const access = await accessibleWorkspace(env, user, decodeURIComponent(members[1]))
    if ('status' in access) return access.status === 404 ? workspaceNotFound() : workspaceDenied()
    if (request.method === 'GET') return json({ results: await listWorkspaceMembers(env, access.workspace.id) })
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const denied = requireOwner(access.workspace)
    if (denied) return denied
    const body = await request.json().catch(() => null) as { userId?: string; email?: string; role?: unknown } | null
    const role = parseWorkspaceRole(body?.role ?? 'viewer')
    if (!role) return json({ error: 'Workspace role is invalid' }, 400)
    const target = body?.userId
      ? await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(body.userId).first<{ id: string }>()
      : body?.email
        ? await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(body.email.trim()).first<{ id: string }>()
        : null
    if (!target) return json({ error: 'User not found' }, 404)
    const now = new Date().toISOString()
    await env.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role').bind(access.workspace.id, target.id, role, now).run()
    await recordAudit(env, access.workspace.id, user.id, 'workspace.member.added', { userId: target.id, role })
    return json({ userId: target.id, role }, 201)
  }

  const detail = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/)
  if (!detail) return json({ error: 'Not found' }, 404)
  const access = await accessibleWorkspace(env, user, decodeURIComponent(detail[1]))
  if ('status' in access) return access.status === 404 ? workspaceNotFound() : workspaceDenied()
  const denied = requireOwner(access.workspace)
  if (denied) return denied
  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null) as { name?: string } | null
    if (invalidWorkspaceName(body?.name)) return json({ error: 'Workspace name is required' }, 400)
    const updatedAt = new Date().toISOString()
    await env.DB.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?').bind(body!.name!.trim(), updatedAt, access.workspace.id).run()
    await recordAudit(env, access.workspace.id, user.id, 'workspace.updated', { name: body!.name!.trim() })
    return json({ ...access.workspace, name: body!.name!.trim(), updated_at: updatedAt })
  }
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405)
  if (access.workspace.id === DEFAULT_WORKSPACE_ID) return json({ error: 'The default workspace cannot be deleted' }, 409)
  const servers = await env.DB.prepare('SELECT COUNT(*) AS count FROM servers WHERE workspace_id = ?').bind(access.workspace.id).first<{ count: number }>()
  if ((servers?.count ?? 0) > 0) return json({ error: 'Workspace still contains servers' }, 409)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM registration_codes WHERE workspace_id = ?').bind(access.workspace.id),
    env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(access.workspace.id),
    env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(access.workspace.id),
  ])
  await recordAudit(env, access.workspace.id, user.id, 'workspace.deleted', { name: access.workspace.name })
  return json({ id: access.workspace.id, deleted: true })
}

async function serverDetailsApi(env: Env, workspace: Workspace, serverId: string): Promise<Response> {
  const server = await env.DB.prepare('SELECT id, name, status, last_seen_at, created_at FROM servers WHERE id = ? AND workspace_id = ?').bind(serverId, workspace.id).first()
  if (!server) return json({ error: 'Plugin server not found' }, 404)
  const [plugins, errors] = await Promise.all([
    env.DB.prepare('SELECT plugin_instances.id, plugin_instances.plugin_id, plugin_instances.name, plugin_instances.version, plugin_instances.state, plugin_instances.desired_state, plugin_instances.server_id, servers.name AS server_name, plugin_instances.manifest_json, plugin_instances.updated_at, domains.hostname AS domain_hostname FROM plugin_instances JOIN servers ON servers.id = plugin_instances.server_id LEFT JOIN domains ON domains.plugin_instance_id = plugin_instances.id WHERE plugin_instances.server_id = ? AND plugin_instances.workspace_id = ? ORDER BY plugin_instances.updated_at DESC').bind(serverId, workspace.id).all(),
    env.DB.prepare('SELECT request_logs.id, request_logs.hostname, request_logs.method, request_logs.path, request_logs.status, request_logs.duration_ms, request_logs.error, request_logs.created_at FROM request_logs JOIN plugin_instances ON plugin_instances.id = request_logs.plugin_instance_id WHERE request_logs.workspace_id = ? AND plugin_instances.server_id = ? AND request_logs.status >= 500 ORDER BY request_logs.created_at DESC LIMIT 20').bind(workspace.id, serverId).all(),
  ])
  return json({ server, plugins: plugins.results, recentErrors: errors.results })
}

export async function syncServer(request: Request, env: Env, user: AuthenticatedUser, workspace: Workspace, serverId: string): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const server = await env.DB.prepare('SELECT id, status FROM servers WHERE id = ? AND workspace_id = ?').bind(serverId, workspace.id).first<{ id: string; status: string }>()
  if (!server) return json({ error: 'Plugin server not found' }, 404)
  if (server.status !== 'online') return json({ error: 'Plugin server is offline' }, 409)
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(serverId))
  const response = await bridge.fetch(new Request(new URL('/command', request.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-plugmesh-server-id': serverId }, body: JSON.stringify({ type: 'server.sync' }) }))
  if (response.ok) await recordAudit(env, workspace.id, user.id, 'server.manifest_sync.requested', { serverId })
  return response
}

async function pluginDetailsApi(env: Env, workspace: Workspace, pluginInstanceId: string): Promise<Response> {
  const plugin = await env.DB.prepare('SELECT plugin_instances.id, plugin_instances.plugin_id, plugin_instances.name, plugin_instances.version, plugin_instances.state, plugin_instances.desired_state, plugin_instances.server_id, plugin_instances.manifest_json, plugin_instances.created_at, plugin_instances.updated_at, servers.name AS server_name, servers.status AS server_status, domains.id AS domain_id, domains.hostname AS domain_hostname, domains.status AS domain_status FROM plugin_instances JOIN servers ON servers.id = plugin_instances.server_id LEFT JOIN domains ON domains.plugin_instance_id = plugin_instances.id WHERE plugin_instances.id = ? AND plugin_instances.workspace_id = ?').bind(pluginInstanceId, workspace.id).first()
  if (!plugin) return json({ error: 'Plugin instance not found' }, 404)
  const recentErrors = await env.DB.prepare('SELECT id, hostname, method, path, status, duration_ms, error, created_at FROM request_logs WHERE workspace_id = ? AND plugin_instance_id = ? AND status >= 500 ORDER BY created_at DESC LIMIT 20').bind(workspace.id, pluginInstanceId).all()
  return json({ plugin, recentErrors: recentErrors.results })
}

async function createBlob(request: Request, env: Env): Promise<Response> {
  const settings = await getPlatformSettings(env)
  if (settings.maintenance) return json({ error: 'Platform is in maintenance mode' }, 503)
  await recordRequest(env)
  await cleanupExpiredBlobs(env)
  if (!request.body) return json({ error: 'Request body is required' }, 400)
  if (!request.headers.has('content-length')) return json({ error: 'Content-Length header is required' }, 411)
  const contentLength = Number(request.headers.get('content-length'))
  const maxBytes = 50 * 1024 * 1024
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) return json({ error: 'Content-Length header is invalid' }, 400)
  if (contentLength > maxBytes) return json({ error: 'File is too large' }, 413)
  const objectKey = `temp/${crypto.randomUUID()}`
  const token = crypto.randomUUID() + crypto.randomUUID()
  const tokenHash = await digest(token)
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream'
  try {
    if (contentLength === 0) {
      await env.BLOB_BUCKET.put(objectKey, new Uint8Array(), { httpMetadata: { contentType } })
    } else {
      const fixed = new FixedLengthStream(contentLength)
      const piping = request.body.pipeTo(fixed.writable).catch(() => undefined)
      await env.BLOB_BUCKET.put(objectKey, fixed.readable, { httpMetadata: { contentType } })
      await piping
    }
  } catch {
    if (!await deleteR2ObjectWithRetry(env, objectKey)) await trackUncollectedObject(env, objectKey, tokenHash, contentType, contentLength)
    return json({ error: 'File upload failed' }, 502)
  }
  const sizeBytes = contentLength
  if (!await reserveR2Usage(env, settings.quotas, sizeBytes)) {
    if (!await deleteR2ObjectWithRetry(env, objectKey)) await trackUncollectedObject(env, objectKey, tokenHash, contentType, sizeBytes)
    await activateMaintenance(env, 'R2 storage quota reached')
    return json({ error: 'Platform quota reached' }, 503)
  }
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  try {
    await env.DB.prepare('INSERT INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), objectKey, tokenHash, contentType, sizeBytes, expiresAt, new Date().toISOString()).run()
  } catch {
    if (await deleteR2ObjectWithRetry(env, objectKey)) await releaseR2Usage(env, sizeBytes)
    else await trackUncollectedObject(env, objectKey, tokenHash, contentType, sizeBytes)
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
  const consumedAt = new Date().toISOString()
  const consumed = await env.DB.prepare('UPDATE temp_objects SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(consumedAt, object.id).run()
  if ((consumed.meta.changes ?? 0) !== 1) return new Response('Resource expired or already consumed', { status: 410 })
  let blob: R2ObjectBody | null
  try {
    blob = await env.BLOB_BUCKET.get(object.object_key)
  } catch {
    await env.DB.prepare('UPDATE temp_objects SET consumed_at = NULL WHERE id = ? AND consumed_at = ?').bind(object.id, consumedAt).run()
    return new Response('Resource temporarily unavailable', { status: 502 })
  }
  if (!blob) {
    ctx.waitUntil((async () => {
      await deleteTempObjectAndRelease(env, object.id, object.size_bytes)
    })())
    return new Response('Resource not found', { status: 404 })
  }
  return new Response(streamConsumedBlob(env, ctx, blob.body, object.id, object.object_key, object.size_bytes, consumedAt), { headers: { 'content-type': object.content_type, 'content-length': String(blob.size), 'cache-control': 'no-store' } })
}

function streamConsumedBlob(env: Env, ctx: ExecutionContext, body: ReadableStream<Uint8Array>, id: string, objectKey: string, sizeBytes: number, consumedAt: string): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let cleaned = false
  let resolveCleanup: () => void = () => undefined
  const cleanupComplete = new Promise<void>((resolve) => { resolveCleanup = resolve })
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    try {
      await finalizeConsumedBlob(env, id, objectKey, sizeBytes, consumedAt)
    } catch {
      // Scheduled cleanup retries stale consumed objects without corrupting the response stream.
    } finally {
      resolveCleanup()
    }
  }
  ctx.waitUntil(cleanupComplete)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          await cleanup()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        await cleanup()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        await cleanup()
      }
    },
  })
}

async function cleanupExpiredBlobs(env: Env): Promise<void> {
  const now = new Date().toISOString()
  const expired = await env.DB.prepare('SELECT id, object_key, size_bytes FROM temp_objects WHERE consumed_at IS NULL AND expires_at <= ? LIMIT 100').bind(now).all<{ id: string; object_key: string; size_bytes: number }>()
  for (const object of expired.results) {
    const consumed = await env.DB.prepare('UPDATE temp_objects SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(now, object.id).run()
    if ((consumed.meta.changes ?? 0) !== 1) continue
    if (!await deleteR2ObjectWithRetry(env, object.object_key)) {
      await env.DB.prepare('UPDATE temp_objects SET consumed_at = NULL WHERE id = ? AND consumed_at = ?').bind(object.id, now).run()
      continue
    }
    await deleteTempObjectAndRelease(env, object.id, object.size_bytes, now)
  }
}

async function finalizeConsumedBlob(env: Env, id: string, objectKey: string, sizeBytes: number, consumedAt: string): Promise<void> {
  if (await deleteR2ObjectWithRetry(env, objectKey)) {
    await deleteTempObjectAndRelease(env, id, sizeBytes, consumedAt)
    return
  }
  await env.DB.prepare('UPDATE temp_objects SET consumed_at = NULL, expires_at = ? WHERE id = ? AND consumed_at = ?').bind(new Date().toISOString(), id, consumedAt).run()
}

async function cleanupStaleConsumedBlobs(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const stale = await env.DB.prepare('SELECT id, object_key, size_bytes, consumed_at FROM temp_objects WHERE consumed_at IS NOT NULL AND consumed_at < ? LIMIT 100').bind(cutoff).all<{ id: string; object_key: string; size_bytes: number; consumed_at: string }>()
  for (const object of stale.results) {
    if (!await deleteR2ObjectWithRetry(env, object.object_key)) continue
    await deleteTempObjectAndRelease(env, object.id, object.size_bytes, object.consumed_at)
  }
}

async function deleteTempObjectAndRelease(env: Env, id: string, sizeBytes: number, consumedAt?: string): Promise<void> {
  const statement = consumedAt
    ? env.DB.prepare('DELETE FROM temp_objects WHERE id = ? AND consumed_at = ?').bind(id, consumedAt)
    : env.DB.prepare('DELETE FROM temp_objects WHERE id = ? AND consumed_at IS NOT NULL').bind(id)
  const deleted = await statement.run()
  if ((deleted.meta.changes ?? 0) === 1) await releaseR2Usage(env, sizeBytes)
}

async function deleteR2ObjectWithRetry(env: Env, objectKey: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await env.BLOB_BUCKET.delete(objectKey)
      return true
    } catch {
      if (attempt < 3) await wait(100 * 2 ** (attempt - 1))
    }
  }
  return false
}

async function trackUncollectedObject(env: Env, objectKey: string, tokenHash: string, contentType: string, sizeBytes: number): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT OR IGNORE INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), objectKey, tokenHash, contentType, sizeBytes, now, now).run().catch(() => undefined)
}

export async function runScheduledMaintenance(env: Env): Promise<void> {
  const now = new Date()
  const nowIso = now.toISOString()
  const accessSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const auditSince = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
  await Promise.all([
    recordUsageSnapshot(env),
    refreshCloudflareUsageOnSchedule(env),
    cleanupExpiredBlobs(env),
    cleanupStaleConsumedBlobs(env),
    env.DB.prepare('DELETE FROM request_logs WHERE created_at < ?').bind(accessSince).run(),
    env.DB.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(auditSince).run(),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso).run(),
    env.DB.prepare('DELETE FROM registration_codes WHERE expires_at <= ?').bind(nowIso).run(),
  ])
}

async function refreshCloudflareUsageOnSchedule(env: Env): Promise<void> {
  const administrator = await env.DB.prepare('SELECT id, email, display_name, role FROM users WHERE role = ? ORDER BY created_at ASC LIMIT 1').bind('super_admin').first<AuthenticatedUser>()
  if (!administrator) return
  await cloudflareUsageApi(env, administrator)
}

async function passwordLogin(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => null) as { password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password) return json({ code: 'password_required', message: '请输入管理员密码' }, 400)
  const userId = await authenticatePassword(env, password)
  if (!userId) return json({ code: 'invalid_password', message: '密码错误' }, 401)
  const token = await createSession(env, userId)
  return new Response(null, { status: 204, headers: { 'set-cookie': sessionCookie(token, url.protocol === 'https:') } })
}

async function passwordSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown } | null
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : ''
  if (!currentPassword) return json({ code: 'current_password_required', message: '请输入当前管理员密码', field: 'currentPassword' }, 400)
  if (newPassword.length < MIN_PASSWORD_LENGTH) return json({ code: 'password_too_short', message: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`, field: 'newPassword' }, 400)
  if (newPassword !== confirmPassword) return json({ code: 'password_mismatch', message: '两次输入的新密码不一致', field: 'confirmPassword' }, 400)
  if (!await changeAdminPassword(env, currentPassword, newPassword)) return json({ code: 'current_password_invalid', message: '当前管理员密码错误', field: 'currentPassword' }, 401)
  return new Response(null, { status: 204 })
}

type AccessLogRecord = {
  workspaceId: string
  userId: string
  domainId: string
  pluginInstanceId: string
  hostname: string
  method: string
  path: string
  status: number
  durationMs: number
  error?: string
}

async function recordAccessLog(env: Env, log: AccessLogRecord): Promise<void> {
  await env.DB.prepare('INSERT INTO request_logs (id, workspace_id, user_id, domain_id, plugin_instance_id, hostname, method, path, status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), log.workspaceId, log.userId, log.domainId, log.pluginInstanceId, log.hostname, log.method.slice(0, 16), log.path.slice(0, 2048), log.status, Math.max(0, Math.round(log.durationMs)), log.error?.slice(0, 160) ?? null, new Date().toISOString()).run()
}

async function accessLogsApi(env: Env, workspace: Workspace): Promise<Response> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await env.DB.prepare('DELETE FROM request_logs WHERE created_at < ?').bind(since).run()
  const [logs, errors] = await Promise.all([
    env.DB.prepare('SELECT id, hostname, method, path, status, duration_ms, error, created_at FROM request_logs WHERE workspace_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 200').bind(workspace.id, since).all(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM request_logs WHERE workspace_id = ? AND created_at >= ? AND status >= 500').bind(workspace.id, since).first<{ count: number }>(),
  ])
  return json({ results: logs.results, errorCount: errors?.count ?? 0, since })
}

async function createRegistrationCode(env: Env, user: AuthenticatedUser, workspace: Workspace): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const rawCode = crypto.randomUUID() + '-' + crypto.randomUUID().slice(0, 8)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO registration_codes (id, user_id, workspace_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, workspace.id, await hashControlToken(rawCode), expiresAt, new Date().toISOString()).run()
  await recordAudit(env, workspace.id, user.id, 'server.registration_code.created', { expiresAt })
  return json({ code: rawCode, expiresAt }, 201)
}

async function commandPlugin(request: Request, env: Env, user: AuthenticatedUser, workspace: Workspace, pluginInstanceId: string, action: 'load' | 'unload' | 'enable' | 'disable' | 'reload' | 'health'): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const plugin = await env.DB.prepare('SELECT plugin_instances.id, plugin_instances.plugin_id, plugin_instances.server_id, plugin_instances.state, plugin_instances.desired_state, domains.hostname AS domain_hostname FROM plugin_instances LEFT JOIN domains ON domains.plugin_instance_id = plugin_instances.id WHERE plugin_instances.id = ? AND plugin_instances.workspace_id = ?').bind(pluginInstanceId, workspace.id).first<{ id: string; plugin_id: string; server_id: string; state: string; desired_state: string; domain_hostname?: string }>()
  if (!plugin) return json({ error: 'Plugin instance not found' }, 404)
  const server = await env.DB.prepare('SELECT status FROM servers WHERE id = ? AND workspace_id = ?').bind(plugin.server_id, workspace.id).first<{ status: string }>()
  if (!server || server.status !== 'online') return json({ error: 'Plugin server is offline' }, 409)
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(plugin.server_id))
  const response = await bridge.fetch(new Request(new URL('/command', request.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-plugmesh-server-id': plugin.server_id }, body: JSON.stringify({ type: `plugin.${action}`, pluginId: plugin.plugin_id }) }))
  if (!response.ok) {
    if (action === 'health') await env.DB.prepare('UPDATE domains SET status = ? WHERE plugin_instance_id = ?').bind('offline', plugin.id).run()
    else {
      const failedAt = new Date().toISOString()
      await env.DB.batch([
        env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE id = ?').bind('failed', failedAt, plugin.id),
        env.DB.prepare('UPDATE domains SET status = ? WHERE plugin_instance_id = ?').bind('offline', plugin.id),
        env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace.id, user.id, `plugin.${action}.failed`, JSON.stringify({ pluginInstanceId: plugin.id, status: response.status }), failedAt),
      ])
    }
    invalidatePluginRoute(plugin.domain_hostname)
    return response
  }
  const result = await response.json().catch(() => null) as { state?: string; status?: number; bodySize?: number } | null
  if (action === 'health') {
    if (typeof result?.status !== 'number' || result.status < 200 || result.status >= 400) {
      await env.DB.prepare('UPDATE domains SET status = ? WHERE plugin_instance_id = ?').bind('offline', plugin.id).run()
      invalidatePluginRoute(plugin.domain_hostname)
      return json({ error: 'Plugin health check failed', status: result?.status ?? null }, 409)
    }
    await env.DB.prepare('UPDATE domains SET status = ? WHERE plugin_instance_id = ?').bind('online', plugin.id).run()
    invalidatePluginRoute(plugin.domain_hostname)
    await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace.id, user.id, 'plugin.health', JSON.stringify({ pluginInstanceId: plugin.id, status: result.status, bodySize: result.bodySize ?? 0 }), new Date().toISOString()).run()
    return json({ id: plugin.id, ok: true, status: result.status, bodySize: result.bodySize ?? 0 }, 200)
  }
  const nextState = result?.state ?? (action === 'load' ? 'loaded' : action === 'unload' ? 'unloaded' : action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : plugin.state)
  const nextDesiredState = action === 'reload' ? plugin.desired_state : action === 'load' ? 'loaded' : action === 'unload' ? 'unloaded' : action === 'enable' ? 'enabled' : 'disabled'
  const updatedAt = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE plugin_instances SET state = ?, desired_state = ?, updated_at = ? WHERE id = ?').bind(nextState, nextDesiredState, updatedAt, plugin.id),
    env.DB.prepare('UPDATE domains SET status = ? WHERE plugin_instance_id = ?').bind('offline', plugin.id),
  ])
  invalidatePluginRoute(plugin.domain_hostname)
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace.id, user.id, `plugin.${action}`, JSON.stringify({ pluginInstanceId: plugin.id }), new Date().toISOString()).run()
  return json({ id: plugin.id, state: nextState, accepted: true }, 202)
}

async function assignDomain(request: Request, env: Env, user: AuthenticatedUser, workspace: Workspace): Promise<Response> {
  if (await isMaintenanceMode(env)) return json({ error: 'Platform is in maintenance mode' }, 503)
  const body = await request.json().catch(() => null) as { pluginInstanceId?: string; prefix?: string } | null
  const prefix = body?.prefix?.trim().toLowerCase() ?? ''
  const reserved = new Set(['admin', 'api', 'auth', 'console', 'control', 'plugins', 'www'])
  if (!body?.pluginInstanceId || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(prefix) || reserved.has(prefix)) return json({ error: 'Invalid domain prefix' }, 400)
  const plugin = await env.DB.prepare('SELECT id, server_id, state FROM plugin_instances WHERE id = ? AND workspace_id = ?').bind(body.pluginInstanceId, workspace.id).first<{ id: string; server_id: string; state: string }>()
  if (!plugin) return json({ error: 'Plugin instance not found' }, 404)
  if (plugin.state !== 'enabled') return json({ error: 'Plugin must be enabled before assigning a domain' }, 409)
  const suffix = await pluginDomainSuffix(env)
  const hostname = `${prefix}${suffix}`
  const server = await env.DB.prepare('SELECT status FROM servers WHERE id = ? AND workspace_id = ?').bind(plugin.server_id, workspace.id).first<{ status: string }>()
  if (!server || server.status !== 'online') return json({ error: 'Plugin server is offline' }, 409)
  const health = await commandPlugin(new Request(new URL(`/api/plugins/${encodeURIComponent(plugin.id)}/health`, request.url), { method: 'POST' }), env, user, workspace, plugin.id, 'health')
  if (!health.ok) return json({ error: 'Plugin health check failed' }, 409)
  try {
    await env.DB.prepare('INSERT INTO domains (id, user_id, workspace_id, plugin_instance_id, hostname, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, workspace.id, plugin.id, hostname, 'online', new Date().toISOString()).run()
  } catch {
    return json({ error: 'Domain is already assigned' }, 409)
  }
  invalidatePluginRoute(hostname)
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace.id, user.id, 'domain.assigned', JSON.stringify({ pluginInstanceId: plugin.id, hostname }), new Date().toISOString()).run()
  return json({ hostname, status: 'online' }, 201)
}

async function connectServer(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
  const serverId = url.searchParams.get('serverId')
  if (!serverId) return json({ error: 'serverId is required' }, 400)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Missing control token' }, 401)
  const tokenHash = await hashControlToken(token)
  const server = await env.DB.prepare('SELECT id FROM servers WHERE id = ? AND token_hash = ? AND status != ?').bind(serverId, tokenHash, 'revoked').first<{ id: string }>()
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
  if ('error' in result) return json({ error: result.error, code: result.code }, result.status)
  return json(result.value, 201)
}

function registerServerSocket(env: Env): Response {
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
        server.send(JSON.stringify({ ok: false, error: 'Invalid JSON', code: 'invalid_registration_request' }))
        server.close(1003, 'Invalid JSON')
        return
      }
      const result = await createServerRegistration(env, body.code, body.name)
      if ('error' in result) server.send(JSON.stringify({ ok: false, error: result.error, code: result.code }))
      else server.send(JSON.stringify({ ok: true, ...result.value }))
      server.close(1000, 'Registration complete')
    })()
  })
  return new Response(null, { status: 101, webSocket: client })
}

export async function createServerRegistration(env: Env, code: string | undefined, name: string | undefined): Promise<{ value: { serverId: string; accessToken: string; protocolVersion: number } } | { error: string; code: string; status: number }> {
  if (!code || !name?.trim()) return { error: 'code and name are required', code: 'invalid_registration_request', status: 400 }
  const codeHash = await hashControlToken(code)
  const serverId = crypto.randomUUID()
  const accessToken = crypto.randomUUID() + crypto.randomUUID()
  const tokenHash = await hashControlToken(accessToken)
  const claimedAt = new Date().toISOString()
  const [inserted, claimed] = await env.DB.batch([
    env.DB.prepare('INSERT INTO servers (id, user_id, workspace_id, name, token_hash, status, created_at) SELECT ?, user_id, workspace_id, ?, ?, ?, ? FROM registration_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(serverId, name.trim(), tokenHash, 'offline', claimedAt, codeHash, claimedAt),
    env.DB.prepare('UPDATE registration_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(claimedAt, codeHash, claimedAt),
    env.DB.prepare("INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) SELECT ?, workspace_id, user_id, 'server.registered', ?, ? FROM servers WHERE id = ?").bind(crypto.randomUUID(), JSON.stringify({ serverId }), claimedAt, serverId),
  ])
  if ((inserted.meta.changes ?? 0) !== 1 || (claimed.meta.changes ?? 0) !== 1) return { error: 'Registration code is invalid or expired', code: 'registration_code_invalid_or_expired', status: 401 }
  return { value: { serverId, accessToken, protocolVersion: 1 } }
}

async function proxyPublicHost(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const suffix = await pluginDomainSuffix(env)
  if (env.CONSOLE_HOSTNAME && url.hostname === configuredConsoleHostname(env, request)) return serveConsole(request, env)
  if (!url.hostname.endsWith(suffix) || url.hostname.length <= suffix.length) return serveConsole(request, env)
  const prefix = url.hostname.slice(0, -suffix.length)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(prefix)) return new Response('Plugmesh console route', { status: 404 })
  const settings = await getPlatformSettings(env)
  if (settings.maintenance) return maintenanceResponse()
  const hostname = url.hostname
  const resolution = resolvePublicRoute(await findPluginRoute(env, hostname))
  if (resolution.state === 'missing') return new Response('Plugin domain not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  if (resolution.state === 'unavailable') return maintenanceResponse('插件暂时不可用', '公开入口尚未就绪、插件当前未启用或插件服务器当前离线。')
  const domain = resolution.route
  const startedAt = Date.now()
  await recordRequest(env)
  const mode = selectPublicRequestMode(request, domain.manifest_json)
  if (!mode) {
    ctx.waitUntil(recordAccessLog(env, { workspaceId: domain.workspace_id, userId: domain.user_id, domainId: domain.domain_id, pluginInstanceId: domain.plugin_instance_id, hostname: domain.hostname, method: request.method, path: url.pathname, status: 501, durationMs: Date.now() - startedAt, error: 'plugin capability unavailable' }))
    return new Response('Plugin capability is not available', { status: 501, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const bridge = env.PLUGIN_BRIDGE.get(env.PLUGIN_BRIDGE.idFromName(domain.server_id))
  const headers = new Headers(request.headers)
  headers.set('x-plugmesh-server-id', domain.server_id)
  headers.set('x-plugmesh-plugin-id', domain.plugin_id)
  headers.set('x-plugmesh-request-path', url.pathname + url.search)
  headers.set('x-plugmesh-request-mode', mode)
  try {
    const bridgeResponse = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
      ? await bridge.fetch(new Request(new URL('/websocket', request.url), { method: 'GET', headers }))
      : await bridge.fetch(new Request(new URL('/proxy', request.url), { method: request.method, headers, body: request.body }))
    const bridgeOffline = bridgeResponse.status === 503 && bridgeResponse.headers.get('x-plugmesh-bridge-error') === 'server-offline'
    const response = bridgeOffline ? maintenanceResponse('插件暂时不可用', '插件服务器当前离线，请稍后再试。') : bridgeResponse
    ctx.waitUntil(recordAccessLog(env, { workspaceId: domain.workspace_id, userId: domain.user_id, domainId: domain.domain_id, pluginInstanceId: domain.plugin_instance_id, hostname: domain.hostname, method: request.method, path: url.pathname, status: response.status, durationMs: Date.now() - startedAt, ...(bridgeOffline ? { error: 'plugin server offline' } : {}) }))
    return response
  } catch {
    ctx.waitUntil(recordAccessLog(env, { workspaceId: domain.workspace_id, userId: domain.user_id, domainId: domain.domain_id, pluginInstanceId: domain.plugin_instance_id, hostname: domain.hostname, method: request.method, path: url.pathname, status: 502, durationMs: Date.now() - startedAt, error: 'bridge request failed' }))
    return new Response('Plugin bridge request failed', { status: 502 })
  }
}

function serveConsole(request: Request, env: Env): Promise<Response> | Response {
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Plugmesh console route', { status: 404 })
}

async function platformSettingsApi(request: Request, env: Env, user: AuthenticatedUser, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const settings = await getPlatformSettings(env)
  if (request.method === 'GET') return json(settings)
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => null) as { maintenance?: boolean; pluginDomainSuffix?: string; quotas?: Partial<typeof defaultPlatformSettings.quotas>; [key: string]: unknown } | null
  if (body && Object.prototype.hasOwnProperty.call(body, 'cloudflareQuotas')) {
    return json({
      code: 'cloudflare_quotas_read_only',
      message: 'Cloudflare 免费额度由 subscriptions 读取，不能在平台设置中修改',
    }, 400)
  }
  const pluginDomainSuffix = body?.pluginDomainSuffix === undefined
    ? settings.pluginDomainSuffix
    : normalizePluginDomainSuffix(body.pluginDomainSuffix)
  if (!pluginDomainSuffix) return json({ error: 'Invalid plugin domain suffix' }, 400)
  let cloudflareDomain: Awaited<ReturnType<typeof configureCloudflareDomain>> | null = null
  if (pluginDomainSuffix !== settings.pluginDomainSuffix) {
    try {
      const stored = await readStoredCloudflareCredential(env)
      if (!stored || stored.kind !== 'global_api_key') throw new CloudflareCredentialError(400, 'credential_required', '请先在 Cloudflare 设置中保存 Email 和 Global API Key，再配置插件域名')
      cloudflareDomain = await configureCloudflareDomain(stored.credential, stored.credential.accountId, pluginDomainSuffix, fetchImpl)
    } catch (error) {
      if (error instanceof CloudflareCredentialError) return json({ code: error.code, message: error.message }, error.status)
      return json({ code: 'domain_configuration_failed', message: 'Cloudflare 域名配置失败' }, 502)
    }
  }
  const next = {
    maintenance: Boolean(body?.maintenance ?? settings.maintenance),
    pluginDomainSuffix,
    quotas: {
      activeConnections: parsePositiveQuota(body?.quotas?.activeConnections, settings.quotas.activeConnections),
      r2Bytes: parsePositiveQuota(body?.quotas?.r2Bytes, settings.quotas.r2Bytes),
      r2Objects: parsePositiveQuota(body?.quotas?.r2Objects, settings.quotas.r2Objects),
    },
  }
  await env.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').bind('platform', JSON.stringify(next), new Date().toISOString()).run()
  setPlatformSettingsCache(next)
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'platform.settings.updated', JSON.stringify(next), new Date().toISOString()).run()
  return json({ ...next, ...(cloudflareDomain ? { cloudflareDomain } : {}) })
}

function parsePositiveQuota(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

type StoredCloudflareCredential = Awaited<ReturnType<typeof readStoredCloudflareCredential>>

function publicCloudflareSettings(stored: StoredCloudflareCredential | null) {
  const base = {
    accountIdConfigured: false,
    accountId: null as string | null,
    email: null as string | null,
    updatedAt: stored?.updatedAt ?? null,
    lastVerifiedAt: null as string | null,
  }
  if (!stored) return { configured: false, credentialKind: null, ...base }
  return {
    configured: true,
    credentialKind: 'global_api_key' as const,
    ...base,
    accountIdConfigured: true,
    accountId: maskCloudflareAccountId(stored.credential.accountId),
    email: stored.credential.email,
    lastVerifiedAt: stored.credential.verifiedAt,
  }
}

function cloudflareCredentialErrorResponse(error: unknown): Response {
  if (error instanceof CloudflareCredentialError) {
    return json({ code: error.code, message: error.message, ...(error.accounts ? { accounts: error.accounts } : {}) }, error.status)
  }
  return json({ code: 'cloudflare_settings_failed', message: 'Cloudflare 设置请求失败' }, 500)
}

/** Cloudflare 设置只接受 Email + Global API Key；保存前完成身份、账号与订阅校验。 */
export async function cloudflareSettingsApi(request: Request, env: Env, user: AuthenticatedUser, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  try {
    if (request.method === 'GET') {
      const stored = await readStoredCloudflareCredential(env)
      return json(publicCloudflareSettings(stored))
    }
    if (request.method === 'DELETE') {
      await deleteStoredCloudflareCredential(env)
      await recordAudit(env, null, user.id, 'cloudflare.credentials.revoked', { credentialKind: 'global_api_key' })
      return json(publicCloudflareSettings(null))
    }
    if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
    if (!env.SESSION_SECRET) throw new CloudflareCredentialError(503, 'secret_missing', 'SESSION_SECRET 未配置，无法安全保存 Cloudflare 凭据')
    const body = await request.json().catch(() => null) as { email?: unknown; globalApiKey?: unknown; accountId?: unknown } | null
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const globalApiKey = typeof body?.globalApiKey === 'string' ? body.globalApiKey.trim() : ''
    if (!email || !globalApiKey) throw new CloudflareCredentialError(400, 'credential_required', '请输入 Cloudflare Email 和 Global API Key')
    const requestedAccountId = typeof body?.accountId === 'string' ? body.accountId.trim() || undefined : undefined
    const validated = await validateCloudflareCredential(email, globalApiKey, requestedAccountId, fetchImpl)
    const updatedAt = await storeCloudflareCredential(env, validated.credential)
    await recordAudit(env, null, user.id, 'cloudflare.credentials.updated', {
      credentialKind: 'global_api_key',
      email: validated.credential.email,
      accountIdConfigured: true,
      planId: validated.subscriptions.plan.id,
      planConfirmed: validated.subscriptions.plan.confirmed,
    })
    return json(publicCloudflareSettings({ kind: 'global_api_key', credential: validated.credential, updatedAt }))
  } catch (error) {
    return cloudflareCredentialErrorResponse(error)
  }
}

/** 读取已保存的 SMTP 配置：解密失败抛出异常，内容无效返回 null。 */
async function readStoredSmtpSettings(env: Env, stored: { ciphertext: string; iv: string } | null): Promise<SmtpSettings | null> {
  if (!stored || !env.SESSION_SECRET) return null
  return parseSmtpSettings(JSON.parse(await decryptSecret(env.SESSION_SECRET, stored.ciphertext, stored.iv)))
}

export async function smtpSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
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
    await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'smtp.settings.revoked', '{}', new Date().toISOString()).run()
    return json({ configured: false, updatedAt: null })
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const parsed = validateSmtpSettings(await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error, field: parsed.field }, 400)
  let password = parsed.settings.password
  if (!password) {
    try {
      password = (await readStoredSmtpSettings(env, existing))?.password ?? ''
    } catch {
      return json({ error: 'SMTP credential decryption failed' }, 500)
    }
  }
  if (!password) return json({ error: 'SMTP password is required', field: 'password' }, 400)
  const settings: SmtpSettings = { ...parsed.settings, password }
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify(settings))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO smtp_settings (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'smtp.settings.updated', JSON.stringify({ host: settings.host, port: settings.port, secure: settings.secure, username: settings.username, authType: settings.authType, from: settings.from }), updatedAt).run()
  return json(publicSmtpSettings(settings, updatedAt))
}

export async function smtpTestApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const body = await request.json().catch(() => null) as { to?: string; settings?: unknown } | null
  if (!body?.to || !isEmail(body.to)) return json({ error: 'A valid test recipient is required', field: 'to' }, 400)
  const stored = await env.DB.prepare('SELECT ciphertext, iv FROM smtp_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  let settings: SmtpSettings | null
  try {
    settings = await readStoredSmtpSettings(env, stored)
  } catch {
    return json({ error: 'SMTP credential decryption failed' }, 500)
  }
  // 表单可携带未保存的配置；空密码沿用已保存密钥，便于首次测试与二次保存。
  if (body.settings !== undefined) {
    const parsed = validateSmtpSettings(body.settings)
    if (!parsed.ok) return json({ error: parsed.error, field: parsed.field }, 400)
    const password = parsed.settings.password || settings?.password || ''
    if (!password) return json({ error: 'SMTP password is required', field: 'password' }, 400)
    settings = { ...parsed.settings, password }
  }
  if (!settings) return json({ error: stored ? 'SMTP settings are invalid' : 'SMTP is not configured' }, stored ? 500 : 409)
  const maxAttempts = 3
  let lastError = 'unknown SMTP error'
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sendSmtpTest(settings, body.to)
      await recordAudit(env, null, user.id, 'smtp.test.sent', { to: body.to, attempts: attempt })
      return json({ sent: true, attempts: attempt })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < maxAttempts) await wait(250 * 2 ** (attempt - 1))
    }
  }
  await recordAudit(env, null, user.id, 'smtp.test.failed', { to: body.to, attempts: maxAttempts, error: redactSmtpError(lastError, settings.password) })
  return json({ error: 'SMTP test send failed', attempts: maxAttempts }, 502)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function redactSmtpError(message: string, password: string): string {
  return message.replaceAll(password, '[REDACTED]').slice(0, 256)
}

export async function cloudflareUsageApi(env: Env, user: AuthenticatedUser, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)

  let stored: StoredCloudflareCredential
  try {
    stored = await readStoredCloudflareCredential(env)
  } catch (error) {
    return cloudflareCredentialErrorResponse(error)
  }
  if (!stored) return json({ configured: false, cached: false })
  // 凭据必须优先于缓存：删除或切换凭据后，旧缓存不能继续伪装成已配置。
  const cached = await env.DB.prepare('SELECT value_json, expires_at, updated_at FROM usage_cache WHERE key = ? AND expires_at > ?').bind('cloudflare:workers', new Date().toISOString()).first<{ value_json: string; expires_at: string; updated_at: string }>()
  const cachedResult = cached ? parseCloudflareUsageCache(cached.value_json) : null
  if (cached && cachedResult) {
    await enforceCloudflareUsageQuotas(env, cachedResult, cachedResult.limits)
    return json({ ...cachedResult, cached: true, updatedAt: cached.updated_at })
  }

  const { accountId } = stored.credential
  const auth = { email: stored.credential.email, globalApiKey: stored.credential.globalApiKey }
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)

  // 免费基线只能来自 subscriptions；不能从平台设置手填，也不能用旧缓存猜测。
  let subscriptions: Awaited<ReturnType<typeof readCloudflareSubscriptions>>
  try {
    subscriptions = await readCloudflareSubscriptions(auth, accountId, fetchImpl)
  } catch (error) {
    // Billing Read only supplies plan metadata and free limits; it must not block usage reads.
    if (error instanceof CloudflareCredentialError && error.status === 403) {
      subscriptions = { subscriptions: [], plan: { id: null, name: null, free: false, confirmed: false } }
    } else {
      return cloudflareCredentialErrorResponse(error)
    }
  }
  const { limitSource, limits } = cloudflarePlanLimits(subscriptions.plan)

  const analyticsRequest = () => fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { 'X-Auth-Email': auth.email, 'X-Auth-Key': auth.globalApiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `query Usage($accountTag: String!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } } } } }`, variables: { accountTag: accountId, start: start.toISOString(), end: end.toISOString() } }),
  })
  let response: Response
  try {
    response = await analyticsRequest()
  } catch {
    return cloudflareAnalyticsError('无法连接 Cloudflare Analytics 接口')
  }
  if (!response.ok) return cloudflareAnalyticsError('Cloudflare Analytics request failed', response.status)
  const payload = await response.json().catch(() => null) as { errors?: unknown[]; data?: { viewer?: { accounts?: Array<{ workersInvocationsAdaptive?: Array<{ sum?: { requests?: number } }> }> } } } | null
  if (!payload) return json({ code: 'cloudflare_analytics_error', message: 'Cloudflare Analytics 响应不是有效 JSON' }, 502)
  if (payload.errors?.length) return json({ code: 'cloudflare_analytics_error', message: 'Cloudflare Analytics returned errors', details: payload.errors }, 502)
  const requests = payload.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests ?? 0
  const resourceAnalyticsRequest = () => fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { 'X-Auth-Email': auth.email, 'X-Auth-Key': auth.globalApiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `query ResourceUsage($accountTag: String!, $start: Date, $end: Date) { viewer { accounts(filter: { accountTag: $accountTag }) { d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) { sum { readQueries writeQueries rowsRead rowsWritten } } kvOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) { sum { requests } dimensions { actionType } } durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end }) { sum { requests } } durableObjectsPeriodicGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end }) { sum { cpuTime } } durableObjectsStorageGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end }) { max { storedBytes } } } } }`, variables: { accountTag: accountId, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) } }),
  })
  let resourceResponse: Response
  try {
    resourceResponse = await resourceAnalyticsRequest()
  } catch {
    return cloudflareAnalyticsError('无法连接 Cloudflare Resource Analytics 接口')
  }
  let resourceAnalyticsAvailable = true
  let resourceAnalyticsError: string | undefined
  if (!resourceResponse.ok) {
    if (resourceResponse.status === 403) {
      resourceAnalyticsAvailable = false
      resourceAnalyticsError = 'Cloudflare Resource Analytics 权限不足，已保留可读取的 Worker 用量'
    } else {
      return cloudflareAnalyticsError('Cloudflare resource analytics request failed', resourceResponse.status)
    }
  }
  const resourcePayload = resourceAnalyticsAvailable ? await resourceResponse.json().catch(() => null) as {
    errors?: unknown[]
    data?: {
      viewer?: {
        accounts?: Array<{
          d1AnalyticsAdaptiveGroups?: Array<{ sum?: { readQueries?: number; writeQueries?: number; rowsRead?: number; rowsWritten?: number } }>
          kvOperationsAdaptiveGroups?: Array<{ sum?: { requests?: number }; dimensions?: { actionType?: string } }>
          durableObjectsInvocationsAdaptiveGroups?: Array<{ sum?: { requests?: number } }>
          durableObjectsPeriodicGroups?: Array<{ sum?: { cpuTime?: number } }>
          durableObjectsStorageGroups?: Array<{ max?: { storedBytes?: number } }>
        }>
      }
    }
  } | null : null
  if (resourceAnalyticsAvailable && !resourcePayload) return json({ code: 'cloudflare_resource_analytics_error', message: 'Cloudflare Resource Analytics 响应不是有效 JSON' }, 502)
  if (resourceAnalyticsAvailable && resourcePayload?.errors?.length) {
    resourceAnalyticsAvailable = false
    resourceAnalyticsError = 'Cloudflare Resource Analytics 返回错误，资源明细暂未读取'
  }
  const resourceAccount = resourceAnalyticsAvailable ? resourcePayload?.data?.viewer?.accounts?.[0] : undefined
  const d1 = resourceAccount?.d1AnalyticsAdaptiveGroups?.reduce((total, row) => ({
    readQueries: total.readQueries + (row.sum?.readQueries ?? 0),
    writeQueries: total.writeQueries + (row.sum?.writeQueries ?? 0),
    rowsRead: total.rowsRead + (row.sum?.rowsRead ?? 0),
    rowsWritten: total.rowsWritten + (row.sum?.rowsWritten ?? 0),
  }), { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 }) ?? { readQueries: 0, writeQueries: 0, rowsRead: 0, rowsWritten: 0 }
  const kv = resourceAccount?.kvOperationsAdaptiveGroups?.reduce((total, row) => {
    const requestsForAction = row.sum?.requests ?? 0
    if (row.dimensions?.actionType === 'read') total.read += requestsForAction
    else if (row.dimensions?.actionType === 'write') total.write += requestsForAction
    else if (row.dimensions?.actionType === 'delete') total.delete += requestsForAction
    else if (row.dimensions?.actionType === 'list') total.list += requestsForAction
    return total
  }, { read: 0, write: 0, delete: 0, list: 0 }) ?? { read: 0, write: 0, delete: 0, list: 0 }
  const durableObjects = {
    requests: resourceAccount?.durableObjectsInvocationsAdaptiveGroups?.reduce((total, row) => total + (row.sum?.requests ?? 0), 0) ?? 0,
    cpuTime: resourceAccount?.durableObjectsPeriodicGroups?.reduce((total, row) => total + (row.sum?.cpuTime ?? 0), 0) ?? 0,
    storedBytes: Math.max(0, ...(resourceAccount?.durableObjectsStorageGroups ?? []).map((row) => row.max?.storedBytes ?? 0)),
  }
  const result: CloudflareUsageResult = {
    configured: true,
    accountIdConfigured: true,
    period: { start: start.toISOString(), end: end.toISOString() },
    requests,
    source: 'cloudflare_graphql',
    plan: subscriptions.plan,
    limitSource,
    limits,
    resourceAnalyticsAvailable,
    ...(resourceAnalyticsError ? { resourceAnalyticsError } : {}),
    ...(resourceAnalyticsAvailable ? { d1, kv, durableObjects } : {}),
  }
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO usage_cache (key, value_json, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at, updated_at = excluded.updated_at').bind('cloudflare:workers', JSON.stringify(result), new Date(Date.now() + 5 * 60 * 1000).toISOString(), updatedAt).run()
  await enforceCloudflareUsageQuotas(env, result, limits)
  return json({ ...result, cached: false, updatedAt })
}

function cloudflareAnalyticsError(message: string, upstreamStatus?: number): Response {
  if (upstreamStatus === 401) return json({ code: 'credential_invalid', message: 'Cloudflare Email 或 Global API Key 无效', upstreamStatus }, 401)
  if (upstreamStatus === 403) return json({ code: 'credential_denied', message: 'Cloudflare Global API Key 无权读取 Analytics', upstreamStatus }, 403)
  return json({ code: 'cloudflare_analytics_failed', message, ...(upstreamStatus === undefined ? {} : { upstreamStatus }) }, 502)
}

type CloudflareUsageResult = {
  configured: true
  accountIdConfigured: true
  period: { start: string; end: string }
  requests: number
  resourceAnalyticsAvailable?: boolean
  resourceAnalyticsError?: string
  d1?: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number }
  kv?: { read: number; write: number; delete: number; list: number }
  durableObjects?: { requests: number; cpuTime: number; storedBytes: number }
  source: 'cloudflare_graphql'
  plan: CloudflarePlanSummary
  limitSource: 'cloudflare_subscriptions_free_baseline' | 'unavailable'
  limits: CloudflareUsageLimits | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isCloudflarePlanSummary(value: unknown): value is CloudflarePlanSummary {
  if (!isRecord(value)) return false
  return (value.id === null || typeof value.id === 'string')
    && (value.name === null || typeof value.name === 'string')
    && typeof value.free === 'boolean'
    && typeof value.confirmed === 'boolean'
}

function hasNonNegativeNumbers(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false
  return keys.every((key) => isNonNegativeNumber(value[key]))
}

function isCloudflareUsageLimits(value: unknown): value is CloudflareUsageLimits {
  if (!isRecord(value)) return false
  const keys: Array<keyof CloudflareUsageLimits> = ['workerRequests', 'd1RowsRead', 'd1RowsWritten', 'kvRead', 'kvWrite', 'kvDelete', 'kvList', 'doRequests']
  return keys.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) > 0)
}

function parseCloudflareUsageCache(value: string): CloudflareUsageResult | null {
  try {
    const result = JSON.parse(value) as unknown
    if (!isRecord(result) || result.configured !== true || result.accountIdConfigured !== true || result.source !== 'cloudflare_graphql') return null
    if (!isRecord(result.period) || typeof result.period.start !== 'string' || typeof result.period.end !== 'string') return null
    if (!isNonNegativeNumber(result.requests)) return null
    const resourceAnalyticsAvailable = result.resourceAnalyticsAvailable !== false
    if (resourceAnalyticsAvailable) {
      if (!hasNonNegativeNumbers(result.d1, ['readQueries', 'writeQueries', 'rowsRead', 'rowsWritten'])) return null
      if (!hasNonNegativeNumbers(result.kv, ['read', 'write', 'delete', 'list'])) return null
      if (!hasNonNegativeNumbers(result.durableObjects, ['requests', 'cpuTime', 'storedBytes'])) return null
    } else if (result.resourceAnalyticsError !== undefined && typeof result.resourceAnalyticsError !== 'string') {
      return null
    }
    if (!isCloudflarePlanSummary(result.plan)) return null
    if (result.limitSource !== 'cloudflare_subscriptions_free_baseline' && result.limitSource !== 'unavailable') return null
    if (result.limits !== null && !isCloudflareUsageLimits(result.limits)) return null
    return result as CloudflareUsageResult
  } catch {
    return null
  }
}

async function enforceCloudflareUsageQuotas(env: Env, usage: CloudflareUsageResult, limits: CloudflareUsageLimits | null): Promise<void> {
  if (!limits) return
  const settings = await getPlatformSettings(env)
  if (settings.maintenance) return
  const reason = cloudflareQuotaReason(usage, limits)
  if (reason) await activateMaintenance(env, reason)
}


export async function localUsageApi(env: Env, user: AuthenticatedUser, url = new URL('https://worker.invalid/api/usage/local'), workspace?: Workspace): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  const workspaceId = workspace?.id ?? null
  const range = url.searchParams.get('range')
  const durationMs = range === '24h' ? 24 * 60 * 60 * 1000 : range === '30d' ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  const since = new Date(Date.now() - durationMs).toISOString()
  const [usage, snapshots, users, plugins, domains] = await Promise.all([
    env.DB.prepare('SELECT request_count, request_window_started_at, active_connections, r2_bytes, r2_objects, updated_at FROM platform_usage WHERE key = ?').bind('global').first<{ request_count: number; request_window_started_at: string; active_connections: number; r2_bytes: number; r2_objects: number; updated_at: string }>(),
    env.DB.prepare('SELECT captured_at, request_count, active_connections, r2_bytes, r2_objects FROM usage_snapshots WHERE captured_at >= ? ORDER BY captured_at ASC').bind(since).all<UsageSnapshot>(),
    env.DB.prepare('SELECT request_logs.user_id AS id, COALESCE(users.display_name, users.email, request_logs.user_id) AS label, COUNT(*) AS requests FROM request_logs LEFT JOIN users ON users.id = request_logs.user_id WHERE request_logs.created_at >= ? AND (? IS NULL OR request_logs.workspace_id = ?) GROUP BY request_logs.user_id ORDER BY requests DESC, label ASC LIMIT 5').bind(since, workspaceId, workspaceId).all<UsageBreakdownEntry>(),
    env.DB.prepare('SELECT request_logs.plugin_instance_id AS id, COALESCE(plugin_instances.name, request_logs.plugin_instance_id) AS label, COUNT(*) AS requests FROM request_logs LEFT JOIN plugin_instances ON plugin_instances.id = request_logs.plugin_instance_id WHERE request_logs.created_at >= ? AND (? IS NULL OR request_logs.workspace_id = ?) GROUP BY request_logs.plugin_instance_id ORDER BY requests DESC, label ASC LIMIT 5').bind(since, workspaceId, workspaceId).all<UsageBreakdownEntry>(),
    env.DB.prepare('SELECT hostname AS id, hostname AS label, COUNT(*) AS requests FROM request_logs WHERE created_at >= ? AND (? IS NULL OR workspace_id = ?) GROUP BY hostname ORDER BY requests DESC, label ASC LIMIT 5').bind(since, workspaceId, workspaceId).all<UsageBreakdownEntry>(),
  ])
  return json({
    // 本地用量来自本平台 D1 中的请求日志，与 Cloudflare 凭据无关，未配置 Cloudflare 时也应返回。
    source: 'platform_local',
    requestCount: usage?.request_count ?? 0,
    requestWindowStartedAt: usage?.request_window_started_at ?? null,
    activeConnections: usage?.active_connections ?? 0,
    r2Bytes: usage?.r2_bytes ?? 0,
    r2Objects: usage?.r2_objects ?? 0,
    updatedAt: usage?.updated_at ?? null,
    snapshots: snapshots.results,
    // 本地计数按用户、插件和域名拆分，范围与快照一致，均来自公开请求日志。
    breakdown: { users: users.results, plugins: plugins.results, domains: domains.results },
  })
}

type UsageBreakdownEntry = {
  id: string
  label: string
  requests: number
}

type UsageSnapshot = {
  captured_at: string
  request_count: number
  active_connections: number
  r2_bytes: number
  r2_objects: number
}

export async function recordUsageSnapshot(env: Env): Promise<void> {
  const usage = await env.DB.prepare('SELECT request_count, active_connections, r2_bytes, r2_objects FROM platform_usage WHERE key = ?').bind('global').first<{ request_count: number; active_connections: number; r2_bytes: number; r2_objects: number }>()
  if (!usage) return
  const capturedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO usage_snapshots (captured_at, request_count, active_connections, r2_bytes, r2_objects) VALUES (?, ?, ?, ?, ?)').bind(capturedAt, usage.request_count, usage.active_connections, usage.r2_bytes, usage.r2_objects).run()
  await env.DB.prepare('DELETE FROM usage_snapshots WHERE captured_at < ?').bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).run()
}

function maintenanceResponse(title = '平台维护中', detail = '平台当前暂停新流量，请稍后再试。'): Response {
  return new Response(`<!doctype html><title>${title}</title><main style="font-family:system-ui;padding:48px"><h1>${title}</h1><p>${detail}</p></main>`, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '300' } })
}

async function pluginDomainSuffix(env: Env): Promise<string> {
  return (await getPlatformSettings(env)).pluginDomainSuffix
}

async function isPluginHostname(hostname: string, env: Env): Promise<boolean> {
  const suffix = await pluginDomainSuffix(env)
  if (!hostname.endsWith(suffix) || hostname.length <= suffix.length) return false
  if (env.CONSOLE_HOSTNAME) return hostname !== env.CONSOLE_HOSTNAME.trim().toLowerCase()
  return Boolean(await findPluginRoute(env, hostname))
}

