import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { cloudflareUsageApi } from '../src/index'
import type { AuthenticatedUser } from '../src/types'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'

const ADMIN_TOKEN = 'analytics-admin-session'
const MEMBER_TOKEN = 'analytics-member-session'
const ACCESS_TOKEN = 'analytics-access-token'
const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

const admin: AuthenticatedUser = { id: 'user-analytics-admin', github_id: 'gh-analytics-admin', email: 'admin@example.com', display_name: 'Analytics Admin', role: 'super_admin' }

const api = (path: string, token: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, {
    ...init,
    headers: {
      cookie: `plugmesh_session=${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  })

async function seedAccounts(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(admin.id, admin.github_id, admin.email, admin.display_name, admin.role, now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-analytics-admin', admin.id, await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-analytics-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

function analyticsFetcher(calls: Array<{ authorization: string | null; query: string }>, handler?: (query: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    const body = JSON.parse(await request.text()) as { query: string }
    calls.push({ authorization: request.headers.get('authorization'), query: body.query })
    return handler ? handler(body.query) : new Response('unexpected analytics request', { status: 500 })
  }) as typeof fetch
}

const requestsPayload = {
  data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 4321 } }] }] } },
}

const resourcesPayload = {
  data: {
    viewer: {
      accounts: [{
        d1AnalyticsAdaptiveGroups: [
          { sum: { readQueries: 3, writeQueries: 2, rowsRead: 100, rowsWritten: 7 } },
          { sum: { readQueries: 1, writeQueries: 4 } },
        ],
        kvOperationsAdaptiveGroups: [
          { sum: { requests: 5 }, dimensions: { actionType: 'read' } },
          { sum: { requests: 2 }, dimensions: { actionType: 'write' } },
          { sum: { requests: 1 }, dimensions: { actionType: 'delete' } },
          { sum: { requests: 3 }, dimensions: { actionType: 'list' } },
          { sum: { requests: 9 }, dimensions: { actionType: 'other' } },
        ],
        durableObjectsInvocationsAdaptiveGroups: [{ sum: { requests: 11 } }, { sum: { requests: 4 } }],
        durableObjectsPeriodicGroups: [{ sum: { cpuTime: 25 } }, { sum: { cpuTime: 5 } }],
        durableObjectsStorageGroups: [{ max: { storedBytes: 1024 } }, { max: { storedBytes: 4096 } }],
      }],
    },
  },
}

function graphqlHandler(query: string): Response {
  if (query.includes('ResourceUsage(')) return Response.json(resourcesPayload)
  if (query.includes('Usage(')) return Response.json(requestsPayload)
  return new Response('unexpected query', { status: 500 })
}

async function saveCredential(accountId: string | null = ACCOUNT_ID): Promise<void> {
  const response = await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ accessToken: ACCESS_TOKEN, accountId: accountId ?? undefined }) })
  expect(response.status).toBe(200)
}

beforeEach(async () => {
  await resetDatabase()
  await seedServer()
  await seedAccounts()
})

test('Cloudflare Analytics 合并 D1/KV/DO 用量并写入五分钟缓存', { timeout: 20_000 }, async () => {
  await saveCredential()
  const calls: Array<{ authorization: string | null; query: string }> = []
  const first = await cloudflareUsageApi(testEnv, admin, analyticsFetcher(calls, graphqlHandler))
  expect(first.status).toBe(200)
  const body = await first.json() as Record<string, unknown>
  expect(body).toMatchObject({
    configured: true,
    accountIdConfigured: true,
    cached: false,
    requests: 4321,
    d1: { readQueries: 4, writeQueries: 6, rowsRead: 100, rowsWritten: 7 },
    kv: { read: 5, write: 2, delete: 1, list: 3 },
    durableObjects: { requests: 15, cpuTime: 30, storedBytes: 4096 },
    source: 'cloudflare_graphql',
  })
  expect(calls).toHaveLength(2)
  expect(calls.every((call) => call.authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(true)

  const cached = await testEnv.DB.prepare('SELECT value_json, expires_at, updated_at FROM usage_cache WHERE key = ?').bind('cloudflare:workers').first<{ value_json: string; expires_at: string; updated_at: string }>()
  expect(cached).toBeTruthy()
  const ttl = Date.parse(cached!.expires_at) - Date.parse(cached!.updated_at)
  expect(ttl).toBeGreaterThan(290_000)
  expect(ttl).toBeLessThanOrEqual(300_000)

  const second = await cloudflareUsageApi(testEnv, admin, analyticsFetcher([], () => new Response('cache miss', { status: 500 })))
  expect(second.status).toBe(200)
  const secondBody = await second.json() as Record<string, unknown>
  expect(secondBody).toMatchObject({ cached: true, requests: 4321, updatedAt: cached!.updated_at })
  expect(secondBody).not.toHaveProperty('accessToken')
})

test('Cloudflare Analytics 错误与权限失败返回 502 且不写缓存', { timeout: 20_000 }, async () => {
  await saveCredential()
  const failed = await cloudflareUsageApi(testEnv, admin, analyticsFetcher([], () => new Response('forbidden', { status: 403 })))
  expect(failed.status).toBe(502)
  expect(await failed.json()).toMatchObject({ error: 'Cloudflare Analytics request failed', status: 403 })

  const errors = await cloudflareUsageApi(testEnv, admin, analyticsFetcher([], () => Response.json({ errors: [{ message: 'quota exceeded' }] })))
  expect(errors.status).toBe(502)
  expect(await errors.json()).toMatchObject({ error: 'Cloudflare Analytics returned errors' })

  const cached = await testEnv.DB.prepare('SELECT key FROM usage_cache WHERE key = ?').bind('cloudflare:workers').first()
  expect(cached).toBeNull()
  expect((await api('/api/usage/cloudflare', MEMBER_TOKEN)).status).toBe(403)
})

test('未配置账号 ID 时跳过 Analytics 请求', { timeout: 20_000 }, async () => {
  await saveCredential(null)
  const calls: Array<{ authorization: string | null; query: string }> = []
  const response = await cloudflareUsageApi(testEnv, admin, analyticsFetcher(calls, graphqlHandler))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ configured: true, accountIdConfigured: false, cached: false })
  expect(calls).toHaveLength(0)
})

test('Analytics 用量达到 D1 配额时进入维护模式', { timeout: 20_000 }, async () => {
  await saveCredential()
  const settings = await api('/api/settings/platform', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ quotas: { d1Queries: 10 } }) })
  expect(settings.status).toBe(200)

  const response = await cloudflareUsageApi(testEnv, admin, analyticsFetcher([], graphqlHandler))
  expect(response.status).toBe(200)

  const platform = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(platform!.value_json).maintenance)).toBe(true)
  const notice = await testEnv.DB.prepare("SELECT detail_json FROM audit_log WHERE action = 'maintenance.email.skipped'").first<{ detail_json: string }>()
  expect(JSON.parse(notice!.detail_json)).toMatchObject({ reason: 'D1 query quota reached' })

  const publicResponse = await SELF.fetch('https://blocked.plugins.example.com/', { headers: { host: 'blocked.plugins.example.com' } })
  expect(publicResponse.status).toBe(503)
  expect(await publicResponse.text()).toContain('平台维护中')
})
