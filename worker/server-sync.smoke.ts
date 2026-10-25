import { strict as assert } from 'node:assert'
import { syncServer } from './src/index.ts'
import type { AuthenticatedUser, Env, Workspace } from './src/types.ts'
import { defaultPlatformSettings, setPlatformSettingsCache } from './src/usage.ts'

type QueryResult = {
  bind: (...values: unknown[]) => QueryResult
  first: <T>() => Promise<T | null>
  run: () => Promise<{ meta: { changes: number } }>
}

function createDatabase(server: { id: string; status: string } | null, ownerId = 'user-1', maintenance = false) {
  const audits: Array<{ action: string; detail: string }> = []
  return {
    audits,
    prepare(sql: string): QueryResult {
      let boundValues: unknown[] = []
      const query: QueryResult = {
        bind: (...values) => {
          boundValues = values
          return query
        },
        first: async <T>() => {
          if (sql.includes('SELECT value_json FROM platform_settings')) return { value_json: JSON.stringify({ maintenance }) } as T
          if (sql.includes('SELECT id FROM servers')) return server && boundValues[1] === 'ws_default' ? server as T : null
          return null
        },
        run: async () => {
          if (sql.includes('INSERT INTO audit_log')) {
            audits.push({ action: String(boundValues[3]), detail: String(boundValues[4]) })
          }
          return { meta: { changes: 1 } }
        },
      }
      return query
    },
  }
}

function createEnvironment(database: ReturnType<typeof createDatabase>, bridgeResponse = new Response(JSON.stringify({ accepted: true }), { status: 202 }), online = true) {
  let bridgeCalls = 0
  let bridgeRequest: Request | null = null
  const bridge = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (request: Request) => {
        if (new URL(request.url).pathname === '/status') return Response.json({ online })
        bridgeCalls += 1
        bridgeRequest = request
        return bridgeResponse
      },
    }),
  }
  return {
    env: { DB: database, PLUGIN_BRIDGE: bridge } as unknown as Env,
    get bridgeCalls() { return bridgeCalls },
    get bridgeRequest() { return bridgeRequest },
  }
}

const workspace: Workspace = { id: 'ws_default', name: '默认工作区', slug: 'default', role: 'owner', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'user@example.test',
  display_name: 'User',
  role: 'member',
}

{
  const database = createDatabase({ id: 'server-1', status: 'online' })
  const environment = createEnvironment(database)
  const response = await syncServer(new Request('https://console.example.test/api/servers/server-1/sync', { method: 'POST' }), environment.env, user, workspace, 'server-1')

  assert.equal(response.status, 202)
  assert.equal(environment.bridgeCalls, 1)
  assert.ok(environment.bridgeRequest)
  assert.equal(environment.bridgeRequest!.method, 'POST')
  assert.equal(environment.bridgeRequest!.headers.get('x-plugmesh-server-id'), 'server-1')
  assert.deepEqual(await environment.bridgeRequest!.json(), { type: 'server.sync' })
  assert.equal(database.audits.length, 1)
  assert.equal(database.audits[0].action, 'server.manifest_sync.requested')
  assert.match(database.audits[0].detail, /server-1/)
}

{
  const database = createDatabase({ id: 'server-1', status: 'online' })
  const environment = createEnvironment(database)
  const response = await syncServer(new Request('https://console.example.test/api/servers/server-1/sync', { method: 'POST' }), environment.env, { ...user, id: 'user-2' }, { ...workspace, id: 'ws_other' }, 'server-1')

  assert.equal(response.status, 404)
  assert.equal(environment.bridgeCalls, 0)
}

{
  const database = createDatabase({ id: 'server-1', status: 'online' })
  const environment = createEnvironment(database, undefined, false)
  const response = await syncServer(new Request('https://console.example.test/api/servers/server-1/sync', { method: 'POST' }), environment.env, user, workspace, 'server-1')

  assert.equal(response.status, 409)
  assert.equal(environment.bridgeCalls, 0)
}

{
  setPlatformSettingsCache({ ...defaultPlatformSettings, maintenance: true })
  const database = createDatabase({ id: 'server-1', status: 'online' }, 'user-1', true)
  const environment = createEnvironment(database)
  const response = await syncServer(new Request('https://console.example.test/api/servers/server-1/sync', { method: 'POST' }), environment.env, user, workspace, 'server-1')

  assert.equal(response.status, 503)
  assert.equal(environment.bridgeCalls, 0)
  setPlatformSettingsCache({ ...defaultPlatformSettings, maintenance: false })
}

console.log('server sync smoke test passed')
