import { strict as assert } from 'node:assert'
import { CLOUDFLARE_FREE_LIMITS } from './src/cloudflare-credentials.ts'
import { cloudflareUsageApi } from './src/index.ts'
import { encryptSecret } from './src/secrets.ts'
import { cloudflareQuotaReason } from './src/usage.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const accountId = '0123456789abcdef0123456789abcdef'
const credential = await encryptSecret('session-secret', JSON.stringify({
  kind: 'global_api_key',
  email: 'admin@example.test',
  globalApiKey: 'cf-global-key-smoke',
  accountId,
  verifiedAt: '2026-10-23T00:00:00.000Z',
}))
let maintenanceUpdates = 0
let resourceVariables: Record<string, string> | null = null
const database = {
  prepare(sql: string) {
    const query = {
      bind: (..._values: unknown[]) => query,
      first: async <T>() => {
        if (sql.includes('FROM cloudflare_credentials')) {
          return { ciphertext: credential.ciphertext, iv: credential.iv, updated_at: '2026-10-23T00:00:00.000Z' } as T
        }
        if (sql.includes('FROM platform_settings')) {
          return { value_json: JSON.stringify({ maintenance: false, pluginDomainSuffix: '.plugins.example.com', quotas: { activeConnections: 100, r2Bytes: 1024, r2Objects: 10 } }) } as T
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
  batch: async () => [],
}
const env = { DB: database, SESSION_SECRET: 'session-secret' } as unknown as Env
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const calls: Array<{ method: string; path: string }> = []
const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input as RequestInfo, init)
  const path = new URL(request.url).pathname
  calls.push({ method: request.method, path })
  if (request.method === 'GET' && path.endsWith('/subscriptions')) {
    return Response.json({
      success: true,
      result: [{ id: 'sub-free', state: 'active', rate_plan: { id: 'free', public_name: 'Free Website' } }],
      errors: [],
      messages: [],
    })
  }
  const body = JSON.parse(String(init?.body)) as { query?: string; variables?: Record<string, string> }
  if (body.query?.includes('ResourceUsage')) {
    assert.match(body.query, /\$accountTag: String!/)
    assert.doesNotMatch(body.query, /\$accountTag: string!/)
    resourceVariables = body.variables ?? null
    return Response.json({ data: { viewer: { accounts: [{
        d1Today: [{ sum: { readQueries: 10, writeQueries: 4, rowsRead: 20, rowsWritten: 5 } }],
        d1StorageAdaptiveGroups: [
          { dimensions: { databaseId: 'database-a', datetimeHour: '2026-10-25T01:00:00Z' }, max: { databaseSizeBytes: 100 } },
          { dimensions: { databaseId: 'database-a', datetimeHour: '2026-10-25T02:00:00Z' }, max: { databaseSizeBytes: 150 } },
          { dimensions: { databaseId: 'database-b', datetimeHour: '2026-10-25T01:00:00Z' }, max: { databaseSizeBytes: 200 } },
        ],
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
}) as typeof fetch

const response = await cloudflareUsageApi(env, admin, fetchImpl)
assert.equal(response.status, 200)
const result = await response.json() as {
  requests: number
  d1Period: { date: string; timezone: string }
  d1: Record<string, number>
  kv: Record<string, number>
  durableObjects: Record<string, number>
  plan: Record<string, unknown>
  limitSource: string
  limits: Record<string, number>
}
assert.equal(result.requests, 99)
assert.deepEqual(result.d1Period, { date: new Date().toISOString().slice(0, 10), timezone: 'UTC' })
assert.equal(resourceVariables?.today, result.d1Period.date)
assert.deepEqual(result.d1, { readQueries: 10, writeQueries: 4, rowsRead: 20, rowsWritten: 5, storageBytes: 350 })
assert.deepEqual(result.kv, { read: 8, write: 3, delete: 1, list: 2 })
assert.deepEqual(result.durableObjects, { requests: 7, cpuTime: 12, storedBytes: 4096 })
assert.deepEqual(result.plan, { id: 'free', name: 'Free Website', free: true, confirmed: true })
assert.equal(result.limitSource, 'cloudflare_subscriptions_free_baseline')
assert.deepEqual(result.limits, CLOUDFLARE_FREE_LIMITS)
assert.equal(calls.map((call) => call.method).join(','), 'GET,POST,POST')
assert.equal(maintenanceUpdates, 0)

assert.equal(cloudflareQuotaReason(result, CLOUDFLARE_FREE_LIMITS), null)
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, workerRequests: 99 }), 'Worker request quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, d1RowsRead: 20 }), 'D1 rows read quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, d1RowsWritten: 5 }), 'D1 rows written quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, d1StorageBytes: 350 }), 'D1 storage quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, kvRead: 8 }), 'KV read quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, kvWrite: 3 }), 'KV write quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, kvDelete: 1 }), 'KV delete quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, kvList: 2 }), 'KV list quota reached')
assert.equal(cloudflareQuotaReason(result, { ...CLOUDFLARE_FREE_LIMITS, doRequests: 7 }), 'Durable Object request quota reached')

console.log('Cloudflare usage smoke test passed')
