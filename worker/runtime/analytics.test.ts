import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cloudflareUsageApi } from '../src/index'
import { encryptSecret } from '../src/secrets'
import type { AuthenticatedUser } from '../src/types'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'
import { CLOUDFLARE_STUB_EMAIL, CLOUDFLARE_STUB_GLOBAL_API_KEY, CLOUDFLARE_STUB_ACCOUNT_ID } from './outbound-stub'

const ADMIN_TOKEN = 'analytics-admin-session'
const MEMBER_TOKEN = 'analytics-member-session'
const ACCOUNT_ID = CLOUDFLARE_STUB_ACCOUNT_ID
const FREE_LIMITS = {
  workerRequests: 100_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  d1StorageBytes: 5_000_000_000,
  kvRead: 100_000,
  kvWrite: 1_000,
  kvDelete: 1_000,
  kvList: 1_000,
  doRequests: 100_000,
}

const admin: AuthenticatedUser = { id: 'user-analytics-admin', email: 'admin@example.com', display_name: 'Analytics Admin', role: 'super_admin' }

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
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(admin.id, 'legacy-admin', admin.email, admin.display_name, admin.role, now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-analytics-admin', admin.id, await hashToken(ADMIN_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-analytics-member', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now),
  ])
}

type UsageCall = { method: string; path: string; email: string | null; key: string | null; query?: string }
type UsageFetcherOptions = {
  subscriptions?: () => Response
  graphql?: (query: string) => Response | Promise<Response>
}

function freeSubscriptions(): Response {
  return Response.json({
    success: true,
    result: [{ id: 'sub-free', state: 'active', rate_plan: { id: 'free', public_name: 'Free Website' } }],
    errors: [],
    messages: [],
  })
}

function planSubscriptions(planId: string | null, planName = 'Plan'): Response {
  return Response.json({
    success: true,
    result: planId ? [{ id: 'sub-1', state: 'active', rate_plan: { id: planId, public_name: planName } }] : [],
    errors: [],
    messages: [],
  })
}

function usageFetcher(calls: UsageCall[], options: UsageFetcherOptions = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    const email = request.headers.get('X-Auth-Email')
    const key = request.headers.get('X-Auth-Key')
    if (request.method === 'GET' && url.pathname.endsWith('/subscriptions')) {
      calls.push({ method: request.method, path: url.pathname, email, key })
      return options.subscriptions ? options.subscriptions() : freeSubscriptions()
    }
    if (request.method === 'POST' && url.pathname === '/client/v4/graphql') {
      const body = JSON.parse(await request.text()) as { query: string }
      calls.push({ method: request.method, path: url.pathname, email, key, query: body.query })
      return options.graphql ? options.graphql(body.query) : new Response('unexpected analytics request', { status: 500 })
    }
    return new Response(`unexpected request: ${request.method} ${request.url}`, { status: 500 })
  }) as typeof fetch
}

const requestsPayload = {
  data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 4321 } }] }] } },
}

const resourcesPayload = {
  data: {
    viewer: {
      accounts: [{
        d1Today: [
          { sum: { readQueries: 3, writeQueries: 2, rowsRead: 100, rowsWritten: 7 } },
          { sum: { readQueries: 1, writeQueries: 4 } },
        ],
        d1StorageAdaptiveGroups: [
          { dimensions: { databaseId: 'database-a', datetimeHour: '2026-10-25T01:00:00Z' }, max: { databaseSizeBytes: 1000 } },
          { dimensions: { databaseId: 'database-a', datetimeHour: '2026-10-25T02:00:00Z' }, max: { databaseSizeBytes: 1500 } },
          { dimensions: { databaseId: 'database-b', datetimeHour: '2026-10-25T01:00:00Z' }, max: { databaseSizeBytes: 2048 } },
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
  const response = await api('/api/settings/cloudflare', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ email: CLOUDFLARE_STUB_EMAIL, globalApiKey: CLOUDFLARE_STUB_GLOBAL_API_KEY, accountId: accountId ?? undefined }) })
  expect(response.status).toBe(200)
}

async function rotateUsageCredentialForFreshRead(): Promise<void> {
  await saveCredential()
}

async function hasD1UsageCacheTable(): Promise<boolean> {
  const table = await testEnv.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind('usage_cache').first()
  return Boolean(table)
}

beforeEach(async () => {
  await resetDatabase()
  await seedServer()
  await seedAccounts()
})

afterEach(() => vi.useRealTimers())

test('Free subscriptions 提供官方基线，Analytics 合并资源并只在内存缓存', { timeout: 20_000 }, async () => {
  await saveCredential()
  const calls: UsageCall[] = []
  const first = await cloudflareUsageApi(testEnv, admin, usageFetcher(calls, { graphql: graphqlHandler }))
  expect(first.status).toBe(200)
  const body = await first.json() as Record<string, unknown>
  expect(body).toMatchObject({
    configured: true,
    accountIdConfigured: true,
    cached: false,
    requests: 4321,
    d1: { readQueries: 4, writeQueries: 6, rowsRead: 100, rowsWritten: 7, storageBytes: 3548 },
    kv: { read: 5, write: 2, delete: 1, list: 3 },
    durableObjects: { requests: 15, cpuTime: 30, storedBytes: 4096 },
    source: 'cloudflare_graphql',
    plan: { id: 'free', name: 'Free Website', free: true, confirmed: true },
    limitSource: 'cloudflare_subscriptions_free_baseline',
    limits: FREE_LIMITS,
  })
  expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'POST'])
  expect(calls[0].path).toBe(`/client/v4/accounts/${ACCOUNT_ID}/subscriptions`)
  expect(calls.every((call) => call.email === CLOUDFLARE_STUB_EMAIL && call.key === CLOUDFLARE_STUB_GLOBAL_API_KEY)).toBe(true)

  expect(await hasD1UsageCacheTable()).toBe(false)

  const second = await cloudflareUsageApi(testEnv, admin, (async () => { throw new Error('valid cache must not call outbound') }) as typeof fetch)
  expect(second.status).toBe(200)
  const secondBody = await second.json() as Record<string, unknown>
  expect(secondBody).toMatchObject({ cached: true, requests: 4321, plan: { id: 'free' }, limits: FREE_LIMITS, updatedAt: body.updatedAt })
  expect(secondBody).not.toHaveProperty('globalApiKey')
})

test('资源明细权限不足时仍返回可读取的 Worker 用量', { timeout: 20_000 }, async () => {
  await saveCredential()
  const calls: UsageCall[] = []
  const response = await cloudflareUsageApi(testEnv, admin, usageFetcher(calls, {
    graphql: (query) => query.includes('ResourceUsage(')
      ? new Response('forbidden', { status: 403 })
      : Response.json(requestsPayload),
  }))
  expect(response.status).toBe(200)
  const body = await response.json() as Record<string, unknown>
  expect(body).toMatchObject({
    configured: true,
    cached: false,
    requests: 4321,
    resourceAnalyticsAvailable: false,
    resourceAnalyticsError: 'Cloudflare Resource Analytics 权限不足，已保留可读取的 Worker 用量',
  })
  expect(body).not.toHaveProperty('d1')
  expect(body).not.toHaveProperty('kv')
  expect(body).not.toHaveProperty('durableObjects')
  expect(calls).toHaveLength(3)
})

test('内存缓存五分钟后过期并重新读取 subscriptions 和 Analytics', { timeout: 20_000 }, async () => {
  await saveCredential()
  const firstCalls: UsageCall[] = []
  const first = await cloudflareUsageApi(testEnv, admin, usageFetcher(firstCalls, { graphql: graphqlHandler }))
  expect(first.status).toBe(200)
  expect(firstCalls).toHaveLength(3)
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + 301_000)

  const calls: UsageCall[] = []
  const refreshed = await cloudflareUsageApi(testEnv, admin, usageFetcher(calls, { graphql: graphqlHandler }))
  expect(refreshed.status).toBe(200)
  const body = await refreshed.json() as Record<string, unknown>
  expect(body).toMatchObject({ configured: true, cached: false, requests: 4321, source: 'cloudflare_graphql' })
  expect(calls).toHaveLength(3)

  expect(calls).toHaveLength(3)
})

test('非 Free 与空/未知 subscriptions 都返回 unavailable，不应用免费基线', { timeout: 20_000 }, async () => {
  await saveCredential()

  const paidCalls: UsageCall[] = []
  const paid = await cloudflareUsageApi(testEnv, admin, usageFetcher(paidCalls, {
    subscriptions: () => planSubscriptions('pro', 'Pro'),
    graphql: graphqlHandler,
  }))
  expect(paid.status).toBe(200)
  expect(await paid.json()).toMatchObject({
    plan: { id: 'pro', name: 'Pro', free: false, confirmed: true },
    limitSource: 'unavailable',
    limits: null,
  })

  await rotateUsageCredentialForFreshRead()
  const emptyCalls: UsageCall[] = []
  const empty = await cloudflareUsageApi(testEnv, admin, usageFetcher(emptyCalls, {
    subscriptions: () => planSubscriptions(null),
    graphql: graphqlHandler,
  }))
  expect(empty.status).toBe(200)
  expect(await empty.json()).toMatchObject({
    plan: { id: null, name: null, free: false, confirmed: false },
    limitSource: 'unavailable',
    limits: null,
  })
})

test('用量缓存只保存在内存，不创建 D1 缓存行', { timeout: 20_000 }, async () => {
  await saveCredential()
  const calls: UsageCall[] = []
  const response = await cloudflareUsageApi(testEnv, admin, usageFetcher(calls, { graphql: graphqlHandler }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    cached: false,
    requests: 4321,
    plan: { id: 'free' },
    limitSource: 'cloudflare_subscriptions_free_baseline',
    limits: FREE_LIMITS,
  })
  expect(calls).toHaveLength(3)
  expect(await hasD1UsageCacheTable()).toBe(false)
})

test('Billing 缺失时仍可刷新用量，凭据无效或 Analytics 缺失仍返回真实 HTTP', { timeout: 20_000 }, async () => {
  await saveCredential()

  const subscriptionDenied = await cloudflareUsageApi(testEnv, admin, usageFetcher([], {
    subscriptions: () => new Response('forbidden', { status: 403 }),
    graphql: graphqlHandler,
  }))
  expect(subscriptionDenied.status).toBe(200)
  expect(await subscriptionDenied.json()).toMatchObject({
    configured: true,
    requests: 4321,
    plan: { id: null, name: null, free: false, confirmed: false },
    limitSource: 'unavailable',
    limits: null,
  })
  await rotateUsageCredentialForFreshRead()

  const subscriptionInvalid = await cloudflareUsageApi(testEnv, admin, usageFetcher([], {
    subscriptions: () => new Response('unauthorized', { status: 401 }),
  }))
  expect(subscriptionInvalid.status).toBe(401)
  expect(await subscriptionInvalid.json()).toMatchObject({ code: 'credential_invalid' })
  await rotateUsageCredentialForFreshRead()

  const analyticsDenied = await cloudflareUsageApi(testEnv, admin, usageFetcher([], {
    graphql: () => new Response('forbidden', { status: 403 }),
  }))
  expect(analyticsDenied.status).toBe(403)
  expect(await analyticsDenied.json()).toMatchObject({ code: 'credential_denied', upstreamStatus: 403 })

  const analyticsInvalid = await cloudflareUsageApi(testEnv, admin, usageFetcher([], {
    graphql: () => new Response('unauthorized', { status: 401 }),
  }))
  expect(analyticsInvalid.status).toBe(401)
  expect(await analyticsInvalid.json()).toMatchObject({ code: 'credential_invalid', upstreamStatus: 401 })

  expect(await hasD1UsageCacheTable()).toBe(false)
  expect((await api('/api/usage/cloudflare', MEMBER_TOKEN)).status).toBe(403)
})

test('Cloudflare 网络失败返回 502 而不是未捕获异常', { timeout: 20_000 }, async () => {
  await saveCredential()
  const response = await cloudflareUsageApi(testEnv, admin, (async () => { throw new Error('network down') }) as typeof fetch)
  expect(response.status).toBe(502)
  expect(await response.json()).toMatchObject({ code: 'cloudflare_upstream_error' })
})

test('未配置 Cloudflare 凭据时判空且不请求任何 Cloudflare API', { timeout: 20_000 }, async () => {
  const calls: UsageCall[] = []
  const response = await cloudflareUsageApi(testEnv, admin, usageFetcher(calls, { graphql: graphqlHandler }))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ configured: false, cached: false })
  expect(calls).toHaveLength(0)
  expect(await hasD1UsageCacheTable()).toBe(false)
})

test('旧格式 Cloudflare 凭据不读取旧缓存也不发起请求', { timeout: 20_000 }, async () => {
  const legacy = await encryptSecret(testEnv.SESSION_SECRET!, JSON.stringify({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh', accountId: ACCOUNT_ID }))
  await testEnv.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?)').bind('primary', legacy.ciphertext, legacy.iv, new Date().toISOString()).run()
  const calls: UsageCall[] = []
  const response = await cloudflareUsageApi(testEnv, admin, usageFetcher(calls, { graphql: graphqlHandler }))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ code: 'credential_unreadable' })
  expect(calls).toHaveLength(0)
  expect(await hasD1UsageCacheTable()).toBe(false)
})

test('确认 Free 且 D1 行读取达到官方基线时进入维护模式', { timeout: 20_000 }, async () => {
  await saveCredential()
  const overLimitPayload = {
    data: { viewer: { accounts: [{ d1Today: [{ sum: { rowsRead: 5_000_000, rowsWritten: 1 } }] }] } },
  }
  const response = await cloudflareUsageApi(testEnv, admin, usageFetcher([], {
    graphql: (query) => query.includes('ResourceUsage(') ? Response.json(overLimitPayload) : Response.json(requestsPayload),
  }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ limitSource: 'cloudflare_subscriptions_free_baseline', limits: FREE_LIMITS })

  const platform = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(platform!.value_json).maintenance)).toBe(true)
  const notice = await testEnv.DB.prepare("SELECT detail_json FROM audit_log WHERE action = 'maintenance.email.skipped'").first<{ detail_json: string }>()
  expect(JSON.parse(notice!.detail_json)).toMatchObject({ reason: 'D1 rows read quota reached' })

  const publicResponse = await SELF.fetch('https://blocked.plugins.example.com/', { headers: { host: 'blocked.plugins.example.com' } })
  expect(publicResponse.status).toBe(503)
  expect(await publicResponse.text()).toContain('平台维护中')
})

test('非 Free 即使 Analytic 用量很高也不应用免费基线', { timeout: 20_000 }, async () => {
  await saveCredential()
  const overLimitPayload = {
    data: { viewer: { accounts: [{ d1Today: [{ sum: { rowsRead: 50_000_000, rowsWritten: 1 } }] }] } },
  }
  const response = await cloudflareUsageApi(testEnv, admin, usageFetcher([], {
    subscriptions: () => planSubscriptions('pro', 'Pro'),
    graphql: (query) => query.includes('ResourceUsage(') ? Response.json(overLimitPayload) : Response.json(requestsPayload),
  }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ limitSource: 'unavailable', limits: null })
  const platform = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(platform).toBeNull()
})

test('平台设置拒绝手填 Cloudflare 额度，GET 不再返回该字段', { timeout: 20_000 }, async () => {
  const rejected = await api('/api/settings/platform', ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ cloudflareQuotas: { d1RowsRead: 10 } }) })
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toMatchObject({ code: 'cloudflare_quotas_read_only' })
  const current = await api('/api/settings/platform', ADMIN_TOKEN)
  expect(current.status).toBe(200)
  expect(await current.json()).not.toHaveProperty('cloudflareQuotas')
})
