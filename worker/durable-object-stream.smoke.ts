import { strict as assert } from 'node:assert'
import { PluginBridge } from './src/durable-object.ts'
import { makeFrame } from './src/protocol.ts'
import type { Env } from './src/types.ts'

class FakeSocket extends EventTarget {
  readyState = 1
  sent: string[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

const stored = new Map<string, Uint8Array>()
let putCount = 0
let deleteCount = 0
const bucket = {
  put: async (key: string, value: ReadableStream<Uint8Array>) => {
    const reader = value.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }
    const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    stored.set(key, body)
    putCount += 1
  },
  get: async (key: string) => {
    const body = stored.get(key)
    if (!body) return null
    return { size: body.byteLength, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(body); controller.close() } }) }
  },
  delete: async (key: string) => {
    stored.delete(key)
    deleteCount += 1
  },
}

const database = {
  prepare(sql: string) {
    const query = {
      bind: (..._values: unknown[]) => query,
      first: async <T>() => sql.includes('FROM platform_settings') ? null as T : null,
      run: async () => ({ meta: { changes: 1 } }),
    }
    return query
  },
}
const env = { DB: database, BLOB_BUCKET: bucket } as unknown as Env
const bridge = new PluginBridge({} as DurableObjectState, env)
const server = new FakeSocket()
const bridgeState = bridge as unknown as { serverSocket: FakeSocket; serverId: string; handleServerMessage: (data: string) => void }
bridgeState.serverSocket = server
bridgeState.serverId = 'server-1'

const responsePromise = bridge.fetch(new Request('https://worker.invalid/proxy', {
  method: 'GET',
  headers: {
    'x-plugmesh-plugin-id': 'sample.plugin',
    'x-plugmesh-request-mode': 'file',
    'x-plugmesh-request-path': '/download',
  },
}))
for (let attempt = 0; attempt < 20 && server.sent.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(server.sent.length, 1)
const request = JSON.parse(server.sent[0]) as { requestId: string }

const open = makeFrame('request.open', 'server-1', { status: 200, headers: { 'content-type': 'application/octet-stream' }, fileStream: true }, 'sample.plugin')
open.requestId = request.requestId
bridgeState.handleServerMessage(JSON.stringify(open))

const expected = new Uint8Array(1024 * 1024 + 123)
for (let index = 0; index < expected.length; index += 1) expected[index] = index % 251
for (let offset = 0; offset < expected.length; offset += 16 * 1024) {
  const chunk = expected.subarray(offset, Math.min(offset + 16 * 1024, expected.length))
  const frame = makeFrame('stream.chunk', 'server-1', { data: Buffer.from(chunk).toString('base64'), encoding: 'base64' }, 'sample.plugin')
  frame.requestId = request.requestId
  bridgeState.handleServerMessage(JSON.stringify(frame))
}
const close = makeFrame('stream.close', 'server-1', { status: 200 }, 'sample.plugin')
close.requestId = request.requestId
bridgeState.handleServerMessage(JSON.stringify(close))

const response = await responsePromise
assert.equal(response.status, 200)
assert.equal(response.headers.get('content-type'), 'application/octet-stream')
assert.equal(response.headers.get('content-length'), String(expected.byteLength))
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected)
assert.equal(putCount, 1)
assert.equal(deleteCount, 1)
assert.equal(stored.size, 0)
console.log('Durable Object file stream smoke test passed')
