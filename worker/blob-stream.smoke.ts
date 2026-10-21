import { strict as assert } from 'node:assert'
import worker from './src/index.ts'
import type { Env } from './src/types.ts'

const expected = new TextEncoder().encode('streamed-object')
let consumedAt: string | null = null
let metadataDeleted = false
let bucketDeletes = 0
let usageReleases = 0

const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (!sql.includes('FROM temp_objects') || consumedAt || metadataDeleted) return null as T
        return { id: 'blob-1', object_key: 'temp/blob-1', content_type: 'application/octet-stream', size_bytes: expected.byteLength, expires_at: '2099-01-01T00:00:00.000Z' } as T
      },
      run: async () => {
        if (sql.includes('UPDATE temp_objects SET consumed_at = ?') && sql.includes('consumed_at IS NULL')) {
          if (consumedAt || metadataDeleted) return { meta: { changes: 0 } }
          consumedAt = values[0] as string
          return { meta: { changes: 1 } }
        }
        if (sql.includes('DELETE FROM temp_objects')) {
          if (metadataDeleted || values[1] !== consumedAt) return { meta: { changes: 0 } }
          metadataDeleted = true
          return { meta: { changes: 1 } }
        }
        if (sql.includes('UPDATE platform_usage SET r2_bytes')) {
          usageReleases += 1
          return { meta: { changes: 1 } }
        }
        if (sql.includes('INSERT OR IGNORE INTO platform_usage')) return { meta: { changes: 1 } }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const bucket = {
  get: async () => ({
    size: expected.byteLength,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(expected)
        controller.close()
      },
    }),
  }),
  delete: async () => { bucketDeletes += 1 },
}

const waits: Promise<unknown>[] = []
const ctx = { waitUntil(value: Promise<unknown>) { waits.push(value) } } as unknown as ExecutionContext
const env = { DB: database, BLOB_BUCKET: bucket } as unknown as Env

const response = await worker.fetch(new Request('https://console.example.test/blobs/download-token'), env, ctx)
assert.equal(response.status, 200)
assert.equal(consumedAt !== null, true)
assert.equal(bucketDeletes, 0)
assert.equal(metadataDeleted, false)
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected)
await Promise.all(waits)
assert.equal(bucketDeletes, 1)
assert.equal(metadataDeleted, true)
assert.equal(usageReleases, 1)

const replay = await worker.fetch(new Request('https://console.example.test/blobs/download-token'), env, ctx)
assert.equal(replay.status, 410)

console.log('blob response stream smoke test passed')
