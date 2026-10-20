import { strict as assert } from 'node:assert'
import { selectPublicRequestMode } from './src/request-mode.ts'

const manifest = (capabilities: Record<string, boolean>) => JSON.stringify({ capabilities })
const all = { http: true, websocket: true, sse: true, fileStream: true }

assert.equal(selectPublicRequestMode(new Request('https://example.test/'), manifest(all)), 'http')
assert.equal(selectPublicRequestMode(new Request('https://example.test/', { headers: { 'x-plugmesh-file-stream': 'true' } }), manifest(all)), 'file')
assert.equal(selectPublicRequestMode(new Request('https://example.test/', { headers: { accept: 'text/event-stream' } }), manifest(all)), 'sse')
assert.equal(selectPublicRequestMode(new Request('https://example.test/', { headers: { upgrade: 'websocket' } }), manifest(all)), 'websocket')
assert.equal(selectPublicRequestMode(new Request('https://example.test/'), manifest({ http: false, websocket: false, sse: false, fileStream: true })), 'file')
assert.equal(selectPublicRequestMode(new Request('https://example.test/'), manifest({ http: false, websocket: false, sse: false, fileStream: false })), null)
assert.equal(selectPublicRequestMode(new Request('https://example.test/'), '{bad json'), null)
console.log('request mode smoke test passed')
