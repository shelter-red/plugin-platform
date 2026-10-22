import { strict as assert } from 'node:assert'
import { cloudflareUsageApi } from './src/index.ts'
import { encryptSecret } from './src/secrets.ts'
import { cloudflareQuotaReason, defaultCloudflareQuotas } from './src/usage.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const credential = await encryptSecret('session-secret', JSON.stringify({ accessToken: 'access-token', accountId: 'account-1' }))
let maintenanceUpdates = 0
const database = {
  prepare(sql: string) {
    const query = {
      bind: (..._values: unknown[]) => query,
      first: async <T>() => {
        if (sql.includes("key = 'cloudflare:workers'")) return null
        if (sql.includes('FROM cloudflare_credentials')) return credential as T
        if (sql.includes('FROM platform_settings')) {
          return { value_json: JSON.stringify({ maintenance: false, cloudflareQuotas: { ...defaultCloudflareQuotas, d1RowsRead: 14 } }) } as T
        }
        return null
      },
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => {
        if (sql.includes("json_set(value_json, '$.maintenance', true)")) maintenanceUpdates += 1
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}
const env = { DB: database, SESSION_SECRET: 'session-secret' } as unknown as Env
const admin: AuthenticatedUser = { id: 'admin-1', github_id: 'github-1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const originalFetch = globalThis.fetch
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { query?: string }
  if (body.query?.includes('ResourceUsage')) {
    assert.match(body.query, /\$accountTag: String!/)
    assert.doesNotMatch(body.query, /\$accountTag: string!/)
    return Response.json({ data: { viewer: { accounts: [{
      d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 10, writeQueries: 4, rowsRead: 20, rowsWritten: 5 } }],
      kvOperationsAdaptiveGroups: [
        { sum: { requests: 8 }, dimensions: { actionType: 'read' } },
        { sum: { requests: 3 }, dimensions: { actionType: 'write' } },
        { sum: { requests: 1 }, dimensions: { actionType: 'delete' } },
        { sum: { requests: 2 }, dimensions: { actionType: 'list' } },
      ],
      durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 7 } }],
      durableObjectsPeriodicGroups: [{ sum: { cpuTime: 12 } }],
      durableObjectsStorageGroups: [{ max: { storedBytes: 4096 } }],
    }] } } })
  }
  return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 99 } }] }] } } })
}

try {
  const response = await cloudflareUsageApi(env, admin)
  assert.equal(response.status, 200)
  const result = await response.json() as { requests: number; d1: Record<string, number>; kv: Record<string, number>; durableObjects: Record<string, number> }
  assert.equal(result.requests, 99)
  assert.deepEqual(result.d1, { readQueries: 10, writeQueries: 4, rowsRead: 20, rowsWritten: 5 })
  assert.deepEqual(result.kv, { read: 8, write: 3, delete: 1, list: 2 })
  assert.deepEqual(result.durableObjects, { requests: 7, cpuTime: 12, storedBytes: 4096 })
  assert.equal(maintenanceUpdates, 1)
  assert.equal(cloudflareQuotaReason(result, defaultCloudflareQuotas), null)
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, workerRequests: 99 }), 'Worker request quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, d1RowsRead: 20 }), 'D1 rows read quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, d1RowsWritten: 5 }), 'D1 rows written quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, kvRead: 8 }), 'KV read quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, kvWrite: 3 }), 'KV write quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, kvDelete: 1 }), 'KV delete quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, kvList: 2 }), 'KV list quota reached')
  assert.equal(cloudflareQuotaReason(result, { ...defaultCloudflareQuotas, doRequests: 7 }), 'Durable Object request quota reached')
} finally {
  globalThis.fetch = originalFetch
}

console.log('Cloudflare usage smoke test passed')
