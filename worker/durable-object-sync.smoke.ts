import { strict as assert } from 'node:assert'
import { PluginBridge } from './src/durable-object.ts'
import { makeFrame } from './src/protocol.ts'
import type { Env, PluginManifest } from './src/types.ts'

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

let domainUpdateStartedResolve: (() => void) | null = null
let releaseDomainUpdateResolve: (() => void) | null = null
const domainUpdateStarted = new Promise<void>((resolve) => { domainUpdateStartedResolve = resolve })
const releaseDomainUpdate = new Promise<void>((resolve) => { releaseDomainUpdateResolve = resolve })
const server = { status: 'offline', lastSeen: null as string | null }
let pluginInserted = false

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
        if (sql.includes('SELECT user_id') && sql.includes('FROM servers')) return { user_id: 'user-1', workspace_id: 'ws_default' } as T
        return null
      },
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => {
        if (sql.startsWith('UPDATE servers SET status')) {
          const [status, lastSeen] = query.values as [string, string]
          server.status = status
          server.lastSeen = lastSeen
          return { meta: { changes: 1 } }
        }
        if (sql.includes('INSERT INTO plugin_instances')) pluginInserted = true
        if (sql.startsWith('UPDATE domains SET status = CASE')) {
          domainUpdateStartedResolve?.()
          await releaseDomainUpdate
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const env = { DB: database } as unknown as Env
const bridge = new PluginBridge({} as DurableObjectState, env)
const socket = new FakeSocket()
const state = bridge as unknown as {
  serverSocket: FakeSocket
  serverId: string
  handleServerMessage: (data: string) => void
  failPendingCommands: (error: string) => void
}
state.serverSocket = socket
state.serverId = 'server-1'

let commandSettled = false
const command = bridge.fetch(new Request('https://bridge.test/command', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'server.sync' }),
})).finally(() => { commandSettled = true })

while (socket.sent.length === 0) await new Promise((resolve) => setTimeout(resolve, 0))
const syncFrame = JSON.parse(socket.sent[0]) as { type: string; requestId: string }
assert.equal(syncFrame.type, 'server.sync')

const manifest: PluginManifest = {
  id: 'sample.plugin',
  name: 'Sample Plugin',
  version: '1.0.0',
  abiVersion: '2',
  library: 'sample.so',
  capabilities: { http: true, websocket: false, sse: false, fileStream: false },
  permissions: [],
  healthPath: '/health',
}

state.handleServerMessage(JSON.stringify(makeFrame('server.register', 'server-1', {
  manifests: [manifest],
  syncRequestId: syncFrame.requestId,
})))
await domainUpdateStarted
assert.equal(pluginInserted, true)

const resultFrames = () => socket.sent.map((frame) => JSON.parse(frame) as { type: string; requestId: string; payload?: Record<string, unknown> })
assert.equal(resultFrames().some((frame) => frame.type === 'server.result'), false)
assert.equal(commandSettled, false)

releaseDomainUpdateResolve?.()

let response: Response
try {
  response = await Promise.race([
    command,
    new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('server.sync did not complete after registration')), 500)),
  ])
} finally {
  if (!commandSettled) state.failPendingCommands('test cleanup')
}

assert.equal(response.status, 202)
assert.deepEqual(resultFrames().map((frame) => frame.type), ['server.sync'])
assert.equal(server.status, 'online')
assert.equal(pluginInserted, true)

console.log('Durable Object server sync ordering smoke test passed')
