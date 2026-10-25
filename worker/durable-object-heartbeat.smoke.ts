import { strict as assert } from 'node:assert'
import { PluginBridge } from './src/durable-object.ts'
import { makeFrame } from './src/protocol.ts'
import type { Env } from './src/types.ts'

let d1Writes = 0
const env = {
  DB: {
    prepare(sql: string) {
      return {
        bind() { return this },
        async run() { d1Writes += 1; return { meta: { changes: 1 } } },
      }
    },
  },
} as unknown as Env

const bridge = new PluginBridge({} as DurableObjectState, env)
const state = bridge as unknown as { serverSocket: { readyState: number } | null; handleServerMessage: (data: string) => void }
state.serverSocket = { readyState: 1 }

for (let index = 0; index < 20; index += 1) {
  state.handleServerMessage(JSON.stringify(makeFrame('server.heartbeat', 'server-1', {})))
}
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(d1Writes, 0, 'heartbeats must not write to D1')

let response = await bridge.fetch(new Request('https://bridge/status'))
assert.deepEqual(await response.json(), { online: true })
state.serverSocket = null
response = await bridge.fetch(new Request('https://bridge/status'))
assert.deepEqual(await response.json(), { online: false })

console.log('Durable Object heartbeat memory-state smoke test passed')
