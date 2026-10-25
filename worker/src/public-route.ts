import type { PluginRoute } from './route-cache'

type PublicRouteResolution = { state: 'missing' } | { state: 'unavailable' | 'ready'; route: PluginRoute }

export function resolvePublicRoute(route: PluginRoute | null): PublicRouteResolution {
  if (!route) return { state: 'missing' }
  if (route.plugin_state !== 'enabled') return { state: 'unavailable', route }
  return { state: 'ready', route }
}
