import type { Env } from './types'

export type PluginRoute = {
  domain_id: string
  user_id: string
  plugin_instance_id: string
  server_id: string
  status: string
  hostname: string
  plugin_id: string
  plugin_state: string
  server_status: string
}

const routeCacheTtlMs = 5_000
const routeCacheMaxEntries = 256
const routeCache = new Map<string, { value: PluginRoute | null; expiresAt: number }>()

export async function findPluginRoute(env: Env, hostname: string): Promise<PluginRoute | null> {
  const cached = routeCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const route = await env.DB.prepare('SELECT domains.id AS domain_id, domains.user_id, domains.plugin_instance_id, domains.server_id, domains.status, domains.hostname, plugin_instances.plugin_id, plugin_instances.state AS plugin_state, servers.status AS server_status FROM domains JOIN plugin_instances ON plugin_instances.id = domains.plugin_instance_id JOIN servers ON servers.id = plugin_instances.server_id WHERE domains.hostname = ?').bind(hostname).first<PluginRoute>()
  routeCache.delete(hostname)
  routeCache.set(hostname, { value: route ?? null, expiresAt: Date.now() + routeCacheTtlMs })
  while (routeCache.size > routeCacheMaxEntries) routeCache.delete(routeCache.keys().next().value as string)
  return route ?? null
}

export function invalidatePluginRoute(hostname: string | null | undefined): void {
  if (hostname) routeCache.delete(hostname)
}
