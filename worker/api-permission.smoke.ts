import { strict as assert } from 'node:assert'
import worker from './src/index.ts'
import { digest } from './src/auth.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const member: AuthenticatedUser = { id: 'member-1', email: 'member@example.test', display_name: 'Member', role: 'member' }
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const sessionTokens = new Map<string, string>()
const users = new Map([[member.id, member], [admin.id, admin]])
const serverQueries: unknown[][] = []
const defaultWorkspace = { id: 'ws_default', name: '默认工作区', slug: 'default', role: 'owner', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }

const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (sql.includes('FROM sqlite_master')) return { present: 1 } as T
        if (sql.includes('FROM admin_credentials')) return { id: 'primary' } as T
        if (sql.includes('FROM sessions')) return (sessionTokens.get(values[0] as string) ? { user_id: sessionTokens.get(values[0] as string) } : null) as T
        if (sql.includes('FROM users WHERE id')) return (users.get(values[0] as string) ?? null) as T
        if (sql.includes('FROM platform_settings')) return { value_json: JSON.stringify({ maintenance: false, quotas: {} }) } as T
        if (sql.includes('FROM workspaces') || sql.includes('JOIN workspaces')) return defaultWorkspace as T
        return null as T
      },
      all: async <T>() => {
        if (sql.includes('FROM workspaces') || sql.includes('JOIN workspaces')) return { results: [defaultWorkspace] } as T
        if (sql.includes('FROM servers WHERE workspace_id')) {
          serverQueries.push(values)
          return { results: [{ id: 'server-member', name: 'Member server', status: 'online', workspace_id: values[0] }] } as T
        }
        return { results: [] } as T
      },
      run: async () => ({ meta: { changes: 1 } }),
    }
    return query
  },
}

const env = { DB: database } as unknown as Env
const ctx = {} as ExecutionContext
const memberToken = 'member-session-token'
const adminToken = 'admin-session-token'
sessionTokens.set(await digest(memberToken), member.id)
sessionTokens.set(await digest(adminToken), admin.id)

const request = (path: string, token?: string) => new Request(`https://console.example.test${path}`, token ? { headers: { cookie: `plugmesh_session=${encodeURIComponent(token)}` } } : undefined)

let response = await worker.fetch(request('/api/me'), env, ctx)
assert.equal(response.status, 401)

response = await worker.fetch(request('/api/settings/platform', memberToken), env, ctx)
assert.equal(response.status, 403)
assert.equal((await response.json() as { error: string }).error, 'Forbidden')

response = await worker.fetch(request('/api/servers', memberToken), env, ctx)
assert.equal(response.status, 200)
assert.deepEqual((await response.json() as { results: Array<{ id: string; workspace_id: string }> }).results, [{ id: 'server-member', name: 'Member server', status: 'online', workspace_id: 'ws_default' }])
assert.deepEqual(serverQueries, [['ws_default']])

response = await worker.fetch(request('/api/settings/platform', adminToken), env, ctx)
assert.equal(response.status, 200)
assert.equal((await response.json() as { maintenance: boolean }).maintenance, false)

console.log('API permission smoke test passed')
