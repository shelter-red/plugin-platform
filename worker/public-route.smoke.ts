import { strict as assert } from 'node:assert'
import { resolvePublicRoute } from './src/public-route.ts'
import type { PluginRoute } from './src/route-cache.ts'

const route = (overrides: Partial<PluginRoute> = {}): PluginRoute => ({
  domain_id: 'domain-1',
  user_id: 'user-1',
  plugin_instance_id: 'instance-1',
  server_id: 'server-1',
  status: 'online',
  hostname: 'sample.plugins.example.test',
  plugin_id: 'sample.plugin',
  manifest_json: '{}',
  plugin_state: 'enabled',
  server_status: 'online',
  ...overrides,
})

assert.equal(resolvePublicRoute(null).state, 'missing')
assert.equal(resolvePublicRoute(route()).state, 'ready')
assert.equal(resolvePublicRoute(route({ status: 'offline' })).state, 'ready')
assert.equal(resolvePublicRoute(route({ server_status: 'offline' })).state, 'ready')
assert.equal(resolvePublicRoute(route({ plugin_state: 'disabled' })).state, 'unavailable')

console.log('public route smoke test passed')
