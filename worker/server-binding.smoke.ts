import { strict as assert } from 'node:assert'
import { PluginBridge } from './src/durable-object.ts'
import { makeFrame } from './src/protocol.ts'
import { hashControlToken } from './src/security.ts'
import type { Env } from './src/types.ts'

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

const server = { status: 'online' as 'online' | 'revoked', tokenHash: 'initial-hash' }
const plugin = { state: 'enabled' }
let domainStatus = 'online'
const executed: { sql: string; values: unknown[] }[] = []

type Query = {
  sql: string
  values: unknown[]
  bind: (...values: unknown[]) => Query
  first: () => Promise<null>
  run: () => Promise<{ meta: { changes: number } }>
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
      first: async () => null,
      run: async () => {
        executed.push({ sql, values: query.values })
        if (sql.includes('UPDATE servers SET token_hash')) {
          if (server.status === 'revoked') return { meta: { changes: 0 } }
          server.tokenHash = String(query.values[0])
          server.status = String(query.values[1]) as 'online' | 'revoked'
          return { meta: { changes: 1 } }
        }
        if (sql.includes('UPDATE servers SET status')) {
          if (server.status === 'revoked') return { meta: { changes: 0 } }
          server.status = 'revoked'
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
  async batch(statements: Query[]) {
    return statements.map((query) => {
      executed.push({ sql: query.sql, values: query.values })
      if (query.sql.includes('UPDATE servers SET status')) {
        if (server.status === 'revoked') return { meta: { changes: 0 } }
        server.status = 'revoked'
        return { meta: { changes: 1 } }
      }
      if (query.sql.includes('UPDATE plugin_instances SET state')) plugin.state = String(query.values[0])
      if (query.sql.includes('UPDATE domains SET status')) domainStatus = String(query.values[0])
      return { meta: { changes: 1 } }
    })
  },
}

const bridge = new PluginBridge({} as DurableObjectState, { DB: database } as unknown as Env)
const socket = new FakeSocket()
const state = bridge as unknown as { serverSocket: FakeSocket; serverId: string; handleServerMessage: (data: string) => void }
state.serverSocket = socket
state.serverId = 'server-1'

const waitForFrame = async (count: number) => {
  for (let attempt = 0; attempt < 200 && socket.sent.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.ok(socket.sent.length >= count, `expected ${count} control frames, saw ${socket.sent.length}`)
  return JSON.parse(socket.sent[count - 1]) as { type: string; requestId: string; payload?: Record<string, unknown> }
}

const rotate = makeFrame('server.rotate', 'server-1', {})
state.handleServerMessage(JSON.stringify(rotate))
const rotated = await waitForFrame(1)
assert.equal(rotated.type, 'server.result')
assert.equal(rotated.requestId, rotate.requestId)
assert.equal(rotated.payload?.action, 'rotate')
const firstToken = String(rotated.payload?.accessToken)
assert.match(firstToken, /^[0-9a-f-]{72}$/)
assert.equal(server.tokenHash, await hashControlToken(firstToken), 'new token hash is stored')

const secondRotate = makeFrame('server.rotate', 'server-1', {})
state.handleServerMessage(JSON.stringify(secondRotate))
const rotatedAgain = await waitForFrame(2)
const secondToken = String(rotatedAgain.payload?.accessToken)
assert.notEqual(secondToken, firstToken, 'rotation issues a new token')
assert.equal(server.tokenHash, await hashControlToken(secondToken))
assert.notEqual(server.tokenHash, await hashControlToken(firstToken), 'previous token no longer matches')

const revoke = makeFrame('server.revoke', 'server-1', {})
state.handleServerMessage(JSON.stringify(revoke))
const revoked = await waitForFrame(3)
assert.equal(revoked.type, 'server.result')
assert.equal(revoked.requestId, revoke.requestId)
assert.equal(revoked.payload?.action, 'revoke')
assert.equal(server.status, 'revoked')
assert.equal(plugin.state, 'server_offline')
assert.equal(domainStatus, 'offline')

const secondRevoke = makeFrame('server.revoke', 'server-1', {})
state.handleServerMessage(JSON.stringify(secondRevoke))
const rejected = await waitForFrame(4)
assert.equal(rejected.type, 'error')
assert.equal(rejected.requestId, secondRevoke.requestId)
assert.equal(rejected.payload?.message, 'Server binding is already revoked or unavailable')

const rotateAfterRevoke = makeFrame('server.rotate', 'server-1', {})
state.handleServerMessage(JSON.stringify(rotateAfterRevoke))
const rotateError = await waitForFrame(5)
assert.equal(rotateError.type, 'error')
assert.equal(rotateError.payload?.message, 'Server binding is revoked or unavailable')
assert.equal(server.tokenHash, await hashControlToken(secondToken), 'revoked server never receives a fresh token')

await new Promise((resolve) => setTimeout(resolve, 100))
assert.equal(socket.readyState, 3, 'socket closes after revoke')
console.log('server binding rotate/revoke smoke test passed')
