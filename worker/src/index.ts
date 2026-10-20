import { PluginBridge } from './durable-object'
import { makeFrame, parseControlFrame } from './protocol'
import { hashControlToken } from './security'
import type { Env } from './types'

export { PluginBridge }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return json({ ok: true, service: 'plugmesh-worker', protocolVersion: 1 })
    if (url.pathname.startsWith('/api/')) return api(request, env, url)
    if (url.pathname === '/control/connect') return connectServer(request, env, url)
    return proxyPublicHost(request, env, url)
  },
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'GET' && url.pathname === '/api/overview') {
    const [servers, plugins, domains] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS count FROM servers WHERE status = ?').bind('online').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM plugin_instances WHERE state = ?').bind('enabled').first<{ count: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM domains').first<{ count: number }>(),
    ])
    return json({ onlineServers: servers?.count ?? 0, enabledPlugins: plugins?.count ?? 0, domains: domains?.count ?? 0 })
  }
  if (request.method === 'GET' && url.pathname === '/api/servers') return json(await env.DB.prepare('SELECT id, name, status, last_seen_at, created_at FROM servers ORDER BY created_at DESC').all())
  if (request.method === 'GET' && url.pathname === '/api/plugins') return json(await env.DB.prepare('SELECT id, plugin_id, name, version, state, server_id, updated_at FROM plugin_instances ORDER BY updated_at DESC').all())
  if (request.method === 'GET' && url.pathname === '/api/domains') return json(await env.DB.prepare('SELECT id, hostname, status, plugin_instance_id, created_at FROM domains ORDER BY created_at DESC').all())
  return json({ error: 'Not found' }, 404)
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
