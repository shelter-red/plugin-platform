import { strict as assert } from 'node:assert'
import { localUsageApi, recordUsageSnapshot } from './src/index.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const snapshots = [
  { captured_at: '2026-10-21T00:00:00.000Z', request_count: 12, active_connections: 2, r2_bytes: 4096, r2_objects: 1 },
  { captured_at: '2026-10-21T00:15:00.000Z', request_count: 18, active_connections: 3, r2_bytes: 8192, r2_objects: 2 },
]
const breakdown = {
  users: [{ id: 'user-1', label: 'Runtime Owner', requests: 12 }],
  plugins: [{ id: 'plugin-1', label: 'Sample Plugin', requests: 12 }],
  domains: [{ id: 'demo.plugins.example.com', label: 'demo.plugins.example.com', requests: 12 }],
}
const database = {
  prepare(sql: string) {
    const query = {
      bind: (..._values: unknown[]) => query,
      first: async <T>() => sql.includes('platform_usage') ? { request_count: 18, request_window_started_at: '2026-10-21T00:00:00.000Z', active_connections: 3, r2_bytes: 8192, r2_objects: 2, updated_at: '2026-10-21T00:15:00.000Z' } as T : null,
      all: async <T>() => ({ results: (sql.includes('usage_snapshots') ? snapshots : sql.includes('LEFT JOIN users') ? breakdown.users : sql.includes('LEFT JOIN plugin_instances') ? breakdown.plugins : breakdown.domains) as T[] }),
      run: async () => ({ meta: { changes: 0 } }),
    }
    return query
  },
}
const env = { DB: database } as unknown as Env
const admin: AuthenticatedUser = { id: 'admin-1', github_id: 'github-1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const member: AuthenticatedUser = { ...admin, id: 'member-1', role: 'member' }

const response = await localUsageApi(env, admin, new URL('https://worker.invalid/api/usage/local?range=24h'))
assert.equal(response.status, 200)
assert.deepEqual(await response.json(), {
  requestCount: 18,
  requestWindowStartedAt: '2026-10-21T00:00:00.000Z',
  activeConnections: 3,
  r2Bytes: 8192,
  r2Objects: 2,
  updatedAt: '2026-10-21T00:15:00.000Z',
  snapshots,
  breakdown,
})

const forbidden = await localUsageApi(env, member)
assert.equal(forbidden.status, 403)

const snapshotWrites: unknown[][] = []
const snapshotDatabase = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => sql.includes('SELECT request_count, active_connections, r2_bytes, r2_objects') ? { request_count: 21, active_connections: 4, r2_bytes: 16384, r2_objects: 3 } as T : null,
      run: async () => {
        if (sql.includes('INSERT INTO usage_snapshots')) snapshotWrites.push(values)
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}
await recordUsageSnapshot({ DB: snapshotDatabase } as unknown as Env)
assert.equal(snapshotWrites.length, 1)
assert.equal(snapshotWrites[0][1], 21)
assert.equal(snapshotWrites[0][2], 4)
assert.equal(snapshotWrites[0][3], 16384)
assert.equal(snapshotWrites[0][4], 3)

console.log('local usage smoke test passed')
