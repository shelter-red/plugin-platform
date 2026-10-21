import { strict as assert } from 'node:assert'
import { findPluginRoute, invalidatePluginRoute, type PluginRoute } from './src/route-cache.ts'
import type { Env } from './src/types.ts'

const routeFor = (hostname: string): PluginRoute => ({
  domain_id: `domain-${hostname}`,
  user_id: 'user-1',
  plugin_instance_id: `plugin-${hostname}`,
  server_id: 'server-1',
  status: 'online',
  hostname,
  plugin_id: 'hello',
  manifest_json: '{}',
  plugin_state: 'enabled',
  server_status: 'online',
})

const lookups: string[] = []
const env = {
  DB: {
    prepare() {
      let hostname = ''
      return {
        bind: (value: string) => {
          hostname = value
          return {
            first: async () => {
              lookups.push(hostname)
              return hostname.startsWith('missing') ? null : routeFor(hostname)
            },
          }
        },
      }
    },
  },
} as unknown as Env

const route = await findPluginRoute(env, 'alpha.plugins.example.com')
assert.equal(route?.domain_id, 'domain-alpha.plugins.example.com')
assert.equal(lookups.length, 1, 'first lookup reaches D1')

await findPluginRoute(env, 'alpha.plugins.example.com')
assert.equal(lookups.length, 1, 'cache hit skips D1')

assert.equal(await findPluginRoute(env, 'missing.plugins.example.com'), null)
assert.equal(lookups.length, 2, 'unknown hostname reaches D1')
assert.equal(await findPluginRoute(env, 'missing.plugins.example.com'), null)
assert.equal(lookups.length, 2, 'negative result is cached')

invalidatePluginRoute('alpha.plugins.example.com')
assert.equal((await findPluginRoute(env, 'alpha.plugins.example.com'))?.hostname, 'alpha.plugins.example.com')
assert.equal(lookups.length, 3, 'invalidation forces a fresh read')

invalidatePluginRoute(null)
invalidatePluginRoute(undefined)
await findPluginRoute(env, 'alpha.plugins.example.com')
assert.equal(lookups.length, 3, 'null hostname invalidation is a no-op')

const realNow = Date.now
Date.now = () => realNow() + 5_001
try {
  await findPluginRoute(env, 'alpha.plugins.example.com')
  assert.equal(lookups.length, 4, 'expired entry falls back to D1')
} finally {
  Date.now = realNow
}

for (let index = 0; index < 300; index += 1) await findPluginRoute(env, `host-${index}.plugins.example.com`)
const afterFill = lookups.length
await findPluginRoute(env, 'host-0.plugins.example.com')
assert.equal(lookups.length, afterFill + 1, 'oldest entry is evicted past the cache limit')
await findPluginRoute(env, 'host-299.plugins.example.com')
assert.equal(lookups.length, afterFill + 1, 'newest entry stays cached')

console.log('route cache smoke test passed')
