import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'

const ADMIN_TOKEN = 'usage-admin-token'
const MEMBER_TOKEN = 'usage-member-token'

const authHeaders = (token: string): Record<string, string> => ({ cookie: `plugmesh_session=${token}` })

const api = (path: string, token: string): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, { headers: authHeaders(token) })

type BreakdownEntry = { id: string; label: string; requests: number }

async function seedAdmin(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-admin', 'gh-admin', 'admin@example.com', 'Admin', 'super_admin', now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-admin', 'user-admin', await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO plugin_instances (id, user_id, server_id, plugin_id, name, version, state, desired_state, manifest_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('plugin-admin', 'user-admin', 'server-runtime', 'admin.plugin', 'Admin Plugin', '1.0.0', 'enabled', 'enabled', '{}', now, now),
    testEnv.DB.prepare('INSERT INTO domains (id, user_id, plugin_instance_id, hostname, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('domain-admin', 'user-admin', 'plugin-admin', 'admin.plugins.example.com', 'online', now),
  ])
}

async function seedRequestLogs(hostname: string): Promise<void> {
  const now = new Date().toISOString()
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
  const log = (id: string, userId: string, domainId: string, pluginInstanceId: string, entryHostname: string, createdAt: string) =>
    testEnv.DB.prepare('INSERT INTO request_logs (id, user_id, domain_id, plugin_instance_id, hostname, method, path, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, domainId, pluginInstanceId, entryHostname, 'GET', '/', 200, 1, createdAt)
  await testEnv.DB.batch([
    log('log-runtime-1', 'user-runtime', 'domain-runtime', 'plugin-runtime', hostname, now),
    log('log-runtime-2', 'user-runtime', 'domain-runtime', 'plugin-runtime', hostname, now),
    log('log-admin-1', 'user-admin', 'domain-admin', 'plugin-admin', 'admin.plugins.example.com', now),
    // 30 天范围之外的日志不应计入分布。
    log('log-runtime-old', 'user-runtime', 'domain-runtime', 'plugin-runtime', hostname, old),
  ])
}

beforeEach(resetDatabase)

test('本地用量按用户、插件与域名拆分最近 30 天请求', async () => {
  const hostname = await seedServer()
  await seedAdmin()
  await seedRequestLogs(hostname)

  const response = await api('/api/usage/local?range=30d', ADMIN_TOKEN)
  expect(response.status).toBe(200)
  const body = (await response.json()) as { breakdown: { users: BreakdownEntry[]; plugins: BreakdownEntry[]; domains: BreakdownEntry[] } }

  expect(body.breakdown.users).toEqual([
    { id: 'user-runtime', label: 'Runtime Owner', requests: 2 },
    { id: 'user-admin', label: 'Admin', requests: 1 },
  ])
  expect(body.breakdown.plugins).toEqual([
    { id: 'plugin-runtime', label: 'Runtime sample', requests: 2 },
    { id: 'plugin-admin', label: 'Admin Plugin', requests: 1 },
  ])
  expect(body.breakdown.domains).toEqual([
    { id: hostname, label: hostname, requests: 2 },
    { id: 'admin.plugins.example.com', label: 'admin.plugins.example.com', requests: 1 },
  ])

  // 默认 7 天窗口同样排除 30 天外日志，并保持相同排序。
  const weekly = (await (await api('/api/usage/local', ADMIN_TOKEN)).json()) as { breakdown: { domains: BreakdownEntry[] } }
  expect(weekly.breakdown.domains[0]).toEqual({ id: hostname, label: hostname, requests: 2 })
})

test('成员读取本地用量分布返回 403', async () => {
  const hostname = await seedServer()
  const now = new Date().toISOString()
  await testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now).run()
  expect((await api('/api/usage/local', MEMBER_TOKEN)).status).toBe(403)
  expect((await api('/api/usage/local', ADMIN_TOKEN)).status).toBe(401)
  expect(hostname.endsWith('.plugins.example.com')).toBe(true)
})
