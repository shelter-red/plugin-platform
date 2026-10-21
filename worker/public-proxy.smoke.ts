import { strict as assert } from 'node:assert'
import worker from './src/index.ts'
import { invalidatePluginRoute } from './src/route-cache.ts'
import { defaultPlatformSettings, setPlatformSettingsCache } from './src/usage.ts'
import type { Env } from './src/types.ts'
import type { PluginRoute } from './src/route-cache.ts'

const readyRoute: PluginRoute = {
  domain_id: 'domain-ready',
  user_id: 'user-1',
  plugin_instance_id: 'instance-ready',
  server_id: 'server-ready',
  status: 'online',
  hostname: 'ready.plugins.example.test',
  plugin_id: 'demo.plugin',
  manifest_json: JSON.stringify({ capabilities: { http: true, websocket: false, sse: false, fileStream: false } }),
  plugin_state: 'enabled',
  server_status: 'online',
}

const routes = new Map<string, PluginRoute | null>([
  [readyRoute.hostname, readyRoute],
  ['offline.plugins.example.test', { ...readyRoute, hostname: 'offline.plugins.example.test', server_status: 'offline' }],
  ['sse.plugins.example.test', { ...readyRoute, hostname: 'sse.plugins.example.test', manifest_json: JSON.stringify({ capabilities: { http: false, websocket: false, sse: true, fileStream: false } }) }],
  ['limited.plugins.example.test', { ...readyRoute, hostname: 'limited.plugins.example.test', manifest_json: JSON.stringify({ capabilities: { http: false, websocket: false, sse: false, fileStream: false } }) }],
])

const bridgeRequests: Request[] = []
const accessLogs: Array<{ status: number; path: string }> = []
const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (sql.includes('SELECT domains.id AS domain_id')) return (routes.get(values[0] as string) ?? null) as T
        return null as T
      },
      run: async () => {
        if (sql.includes('INSERT INTO request_logs')) accessLogs.push({ status: values[7] as number, path: values[6] as string })
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const bridge = {
  async fetch(request: Request): Promise<Response> {
    bridgeRequests.push(request)
    if (request.headers.get('x-plugmesh-request-mode') === 'sse') return new Response('data: hello\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    return new Response('proxied', { status: 201, headers: { 'x-plugin-response': 'ok' } })
  },
}

const env = {
  DB: database,
  PLUGIN_DOMAIN_SUFFIX: '.plugins.example.test',
  PLUGIN_BRIDGE: {
    idFromName: (name: string) => name,
    get: (id: string) => {
      assert.equal(id, 'server-ready')
      return bridge
    },
  },
} as unknown as Env

const waits: Promise<unknown>[] = []
const ctx = { waitUntil(value: Promise<unknown>) { waits.push(value) } } as unknown as ExecutionContext

async function fetchPublic(hostname: string, init?: RequestInit): Promise<Response> {
  invalidatePluginRoute(hostname)
  const request = new Request(`https://${hostname}/items?source=smoke`, init)
  return worker.fetch(request, env, ctx)
}

setPlatformSettingsCache(defaultPlatformSettings)
let response = await fetchPublic('missing.plugins.example.test')
assert.equal(response.status, 404)
assert.equal(await response.text(), 'Plugin domain not found')
assert.equal(bridgeRequests.length, 0)

response = await fetchPublic('offline.plugins.example.test')
assert.equal(response.status, 503)
assert.match(await response.text(), /插件暂时不可用/)
assert.equal(bridgeRequests.length, 0)

setPlatformSettingsCache({ ...defaultPlatformSettings, maintenance: true })
response = await fetchPublic(readyRoute.hostname)
assert.equal(response.status, 503)
assert.match(await response.text(), /平台维护中/)
assert.equal(bridgeRequests.length, 0)

setPlatformSettingsCache(defaultPlatformSettings)
response = await fetchPublic(readyRoute.hostname, { method: 'GET' })
assert.equal(response.status, 201)
assert.equal(await response.text(), 'proxied')
assert.equal(response.headers.get('x-plugin-response'), 'ok')
assert.equal(bridgeRequests.at(-1)?.headers.get('x-plugmesh-server-id'), 'server-ready')
assert.equal(bridgeRequests.at(-1)?.headers.get('x-plugmesh-plugin-id'), 'demo.plugin')
assert.equal(bridgeRequests.at(-1)?.headers.get('x-plugmesh-request-path'), '/items?source=smoke')
assert.equal(bridgeRequests.at(-1)?.headers.get('x-plugmesh-request-mode'), 'http')

response = await fetchPublic('sse.plugins.example.test', { headers: { accept: 'text/event-stream' } })
assert.equal(response.status, 200)
assert.equal(response.headers.get('content-type'), 'text/event-stream')
assert.equal(await response.text(), 'data: hello\n\n')
assert.equal(bridgeRequests.at(-1)?.headers.get('x-plugmesh-request-mode'), 'sse')

const bridgeCountBeforeUnsupported = bridgeRequests.length
response = await fetchPublic('limited.plugins.example.test')
assert.equal(response.status, 501)
assert.equal(await response.text(), 'Plugin capability is not available')
assert.equal(bridgeRequests.length, bridgeCountBeforeUnsupported)

await Promise.all(waits)
assert.deepEqual(accessLogs.map((entry) => entry.status), [201, 200, 501])
assert.deepEqual(accessLogs.map((entry) => entry.path), ['/items', '/items', '/items'])

console.log('public proxy smoke test passed')
