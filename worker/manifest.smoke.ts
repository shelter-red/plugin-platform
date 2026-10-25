import { strict as assert } from 'node:assert'
import { isManifest } from './src/protocol.ts'

const manifest = (abiVersion: string) => ({
  id: 'example.plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  abiVersion,
  library: 'example.so',
  capabilities: { http: true, websocket: true, sse: false, fileStream: false },
  permissions: [],
  healthPath: '/health',
})

assert.equal(isManifest(manifest('1')), true)
assert.equal(isManifest(manifest('2')), false)
assert.equal(isManifest(manifest('3')), false)
assert.equal(isManifest(manifest('4')), false)
assert.equal(isManifest(manifest('5')), false)

console.log('manifest ABI smoke test passed')
