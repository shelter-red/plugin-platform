import { strict as assert } from 'node:assert'
import { PluginBridge } from './src/durable-object.ts'
import { makeFrame } from './src/protocol.ts'
import type { Env, PluginManifest } from './src/types.ts'

type ServerState = {
  status: 'online' | 'offline' | 'revoked'
  lastSeen: string | null
}

type PluginState = {
  id: string
  pluginId: string
  state: string
  desiredState: string
}

type Query = {
  sql: string
  values: unknown[]
  bind: (...values: unknown[]) => Query
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<{ results: T[] }>
  run: () => Promise<{ meta: { changes: number } }>
}

class FakeSocket {
  readyState = 1
  sent: string[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

const server: ServerState = { status: 'offline', lastSeen: null }
const plugin: PluginState = { id: 'instance-1', pluginId: 'sample.plugin', state: 'server_offline', desiredState: 'discovered' }
let domainStatus = 'offline'
let registrationCount = 0
let delayOfflineBatch = false
let offlineBatchStartedResolve: (() => void) | null = null
let releaseOfflineBatchResolve: (() => void) | null = null
const offlineBatchStarted = new Promise<void>((resolve) => { offlineBatchStartedResolve = resolve })
const releaseOfflineBatch = new Promise<void>((resolve) => { releaseOfflineBatchResolve = resolve })

const guardMatches = (query: Query) => {
  if (!query.sql.includes('servers.last_seen_at = ?')) return true
  const [serverId, expectedStatus, expectedLastSeen] = query.values.slice(-3)
  return serverId === 'server-1' && server.status === expectedStatus && server.lastSeen === expectedLastSeen
}

const database = {
  prepare(sql: string): Query {
    const query: Query = {
      sql,
      values: [],
      bind: (...values) => {
        query.values = values
        return query
      },
      first: async <T>() => {
        if (sql.includes('SELECT user_id') && sql.includes('FROM servers')) return server.status === 'revoked' ? null : { user_id: 'user-1', workspace_id: 'ws_default' } as T
        return null
      },
      all: async <T>() => {
        if (sql.includes('SELECT id, plugin_id FROM plugin_instances')) return { results: [{ id: plugin.id, plugin_id: plugin.pluginId }] as T[] }
        if (sql.includes('SELECT id, plugin_id, desired_state FROM plugin_instances')) {
          const restorable = ['loaded', 'enabled', 'disabled'].includes(plugin.desiredState)
          return { results: restorable ? [{ id: plugin.id, plugin_id: plugin.pluginId, desired_state: plugin.desiredState }] as T[] : [] }
        }
        return { results: [] }
      },
      run: async () => {
        if (sql.startsWith('UPDATE servers SET status')) {
          const [status, lastSeen] = query.values as [ServerState['status'], string]
          if (server.status === 'revoked') return { meta: { changes: 0 } }
          if (status === 'offline' && server.lastSeen && server.lastSeen > String(query.values[4])) return { meta: { changes: 0 } }
          server.status = status
          server.lastSeen = lastSeen
          return { meta: { changes: 1 } }
        }
        if (sql.includes('INSERT INTO plugin_instances')) {
          plugin.pluginId = String(query.values[4])
          if (plugin.state === 'server_offline') plugin.state = 'discovered'
          return { meta: { changes: 1 } }
        }
        if (sql.startsWith('UPDATE plugin_instances SET state')) {
          plugin.state = String(query.values[0])
          return { meta: { changes: 1 } }
        }
        if (sql.startsWith('UPDATE domains SET status = CASE')) {
          domainStatus = plugin.state === 'enabled' ? 'online' : 'offline'
          registrationCount += 1
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
  async batch(statements: Query[]) {
    if (delayOfflineBatch) {
      offlineBatchStartedResolve?.()
      await releaseOfflineBatch
    }
    return statements.map((query) => {
      if (!guardMatches(query)) return { meta: { changes: 0 } }
      if (query.sql.startsWith('UPDATE plugin_instances')) plugin.state = 'server_offline'
      if (query.sql.startsWith('UPDATE domains')) domainStatus = 'offline'
      return { meta: { changes: 1 } }
    })
  },
}

const manifest: PluginManifest = {
  id: 'sample.plugin',
  name: 'Sample Plugin',
  version: '1.0.0',
  abiVersion: '1',
  library: 'sample.so',
  capabilities: { http: true, websocket: false, sse: false, fileStream: false },
  permissions: [],
  healthPath: '/health',
}

const waitForRegistration = async (expected: number) => {
  for (let attempt = 0; attempt < 100 && registrationCount < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.equal(registrationCount, expected)
}

const env = { DB: database } as unknown as Env
const bridge = new PluginBridge({} as DurableObjectState, env)
const socket = new FakeSocket()
const bridgeState = bridge as unknown as {
  serverSocket: FakeSocket
  serverId: string
  handleServerMessage: (data: string) => void
  markServerOffline: () => Promise<void>
}
bridgeState.serverSocket = socket
bridgeState.serverId = 'server-1'

bridgeState.handleServerMessage(JSON.stringify(makeFrame('server.register', 'server-1', { manifests: [manifest] })))
await waitForRegistration(1)
assert.equal(server.status, 'online')
assert.equal(plugin.state, 'discovered')
assert.equal(domainStatus, 'offline')

plugin.state = 'enabled'
domainStatus = 'online'
delayOfflineBatch = true
const disconnect = bridgeState.markServerOffline()
await offlineBatchStarted
assert.equal(server.status, 'offline')

bridgeState.handleServerMessage(JSON.stringify(makeFrame('server.register', 'server-1', { manifests: [manifest] })))
await waitForRegistration(2)
assert.equal(server.status, 'online')
assert.equal(plugin.state, 'enabled')
assert.equal(domainStatus, 'online')

releaseOfflineBatchResolve?.()
await disconnect
assert.equal(server.status, 'online')
assert.equal(plugin.state, 'enabled')
assert.equal(domainStatus, 'online')
assert.equal(socket.readyState, 1)

console.log('Durable Object lifecycle reconnect smoke test passed')
