import { beforeEach, expect, test } from 'vitest'
import {
  CLOUDFLARE_API_TOKEN_PERMISSIONS,
  CloudflareTokenError,
  configureCloudflareDomain,
  deleteStoredCloudflareCredential,
  listCloudflareAccounts,
  readCloudflareSubscriptions,
  readStoredCloudflareCredential,
  selectCloudflareAccountId,
  storeCloudflareCredential,
  validateCloudflareApiToken,
  verifyCloudflareApiToken,
} from '../src/cloudflare-token'
import { encryptSecret } from '../src/secrets'
import { resetDatabase, testEnv } from './helpers'

const TOKEN = 'cf-api-token-secret'
const ACCOUNT_A = '0123456789abcdef0123456789abcdef'
const ACCOUNT_B = 'fedcba9876543210fedcba9876543210'

type Call = { path: string; authorization: string | null; method: string }

function jsonFetcher(routes: Record<string, (call: Call) => Response>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    const call = { path: `${url.pathname}${url.search}`, authorization: request.headers.get('authorization'), method: request.method }
    calls.push(call)
    const handler = routes[call.path]
    if (!handler) return new Response(`unexpected request: ${call.path}`, { status: 500 })
    return handler(call)
  }) as typeof fetch
}

function accountPage(ids: string[], page: number, totalPages: number): Response {
  return Response.json({
    success: true,
    result: ids.map((id, index) => ({ id, name: `Account ${page}-${index}` })),
    result_info: { page, per_page: 50, count: ids.length, total_pages: totalPages },
  })
}

function subscriptions(planId: string | null, planName = 'Plan'): Response {
  return Response.json({
    success: true,
    result: [{ id: 'sub-1', state: 'active', rate_plan: planId ? { id: planId, public_name: planName } : undefined }],
    errors: [],
    messages: [],
  })
}

beforeEach(async () => {
  await resetDatabase()
})

test('固定权限列表使用 Cloudflare 官方监控与域名权限', () => {
  expect([...CLOUDFLARE_API_TOKEN_PERMISSIONS]).toEqual([
    'Account Settings Read',
    'Account Analytics Read',
    'Billing Read',
    'Zone Read',
    'DNS Write',
    'Workers Routes Edit',
  ])
})

test('保存前依次验证 Token、遍历全部账号并读取订阅', async () => {
  const calls: Call[] = []
  const fetchImpl = jsonFetcher({
    '/client/v4/user/tokens/verify': () => Response.json({ success: true, result: { id: 'token-id', status: 'active' } }),
    '/client/v4/accounts?page=1&per_page=50': () => accountPage([ACCOUNT_A], 1, 2),
    '/client/v4/accounts?page=2&per_page=50': () => accountPage([ACCOUNT_B], 2, 2),
    [`/client/v4/accounts/${ACCOUNT_B}/subscriptions`]: () => subscriptions('free', 'Free Website'),
  }, calls)

  const result = await validateCloudflareApiToken(TOKEN, ACCOUNT_B, fetchImpl)
  expect(result.account).toEqual({ id: ACCOUNT_B, name: 'Account 2-0' })
  expect(result.credential).toMatchObject({ kind: 'api_token', apiToken: TOKEN, accountId: ACCOUNT_B })
  expect(result.subscriptions.plan).toEqual({ id: 'free', name: 'Free Website', free: true, confirmed: true })
  expect(calls.map((call) => call.path)).toEqual([
    '/client/v4/user/tokens/verify',
    '/client/v4/accounts?page=1&per_page=50',
    '/client/v4/accounts?page=2&per_page=50',
    `/client/v4/accounts/${ACCOUNT_B}/subscriptions`,
  ])
  expect(calls.every((call) => call.authorization === `Bearer ${TOKEN}`)).toBe(true)
})

test('完整分页后发现多个账号但未指定 Account ID 时返回 409', async () => {
  const fetchImpl = jsonFetcher({
    '/client/v4/user/tokens/verify': () => Response.json({ success: true, result: { status: 'active' } }),
    '/client/v4/accounts?page=1&per_page=50': () => accountPage([ACCOUNT_A], 1, 2),
    '/client/v4/accounts?page=2&per_page=50': () => accountPage([ACCOUNT_B], 2, 2),
  })
  await expect(validateCloudflareApiToken(TOKEN, undefined, fetchImpl)).rejects.toMatchObject({
    status: 409,
    code: 'account_ambiguous',
  })
})

test('指定账号不在完整分页结果中时返回 account_missing', async () => {
  const fetchImpl = jsonFetcher({
    '/client/v4/user/tokens/verify': () => Response.json({ success: true, result: { status: 'active' } }),
    '/client/v4/accounts?page=1&per_page=50': () => accountPage([ACCOUNT_A], 1, 1),
  })
  await expect(validateCloudflareApiToken(TOKEN, ACCOUNT_B, fetchImpl)).rejects.toMatchObject({
    status: 409,
    code: 'account_missing',
  })
  expect(() => selectCloudflareAccountId([], undefined)).toThrow('Token 没有可见的 Cloudflare 账号')
})

test('无效 Token、权限不足和上游失败使用稳定错误码', async () => {
  await expect(verifyCloudflareApiToken(TOKEN, jsonFetcher({
    '/client/v4/user/tokens/verify': () => Response.json({ success: false, errors: [{ message: 'Invalid API Token' }] }, { status: 401 }),
  }))).rejects.toMatchObject({ status: 401, code: 'token_invalid' })

  await expect(listCloudflareAccounts(TOKEN, jsonFetcher({
    '/client/v4/accounts?page=1&per_page=50': () => Response.json({ success: false, errors: [{ message: 'Authentication error' }] }, { status: 403 }),
  }))).rejects.toMatchObject({ status: 403, code: 'token_permission_denied' })

  await expect(readCloudflareSubscriptions(TOKEN, ACCOUNT_A, jsonFetcher({
    [`/client/v4/accounts/${ACCOUNT_A}/subscriptions`]: () => new Response('upstream down', { status: 503 }),
  }))).rejects.toMatchObject({ status: 502, code: 'cloudflare_upstream_error', upstreamStatus: 503 })
})

test('使用 Token 自动配置 Zone、通配 DNS 和 Worker Route', async () => {
  const calls: Call[] = []
  const fetchImpl = jsonFetcher({
    [`/client/v4/zones?account.id=${ACCOUNT_A}&status=active&page=1&per_page=50`]: () => Response.json({
      success: true,
      result: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
      result_info: { page: 1, per_page: 50, count: 1, total_pages: 1 },
    }),
    '/client/v4/zones/zone-1/dns_records?name=*.plugins.example.com': () => Response.json({ success: true, result: [] }),
    '/client/v4/zones/zone-1/dns_records': () => Response.json({ success: true, result: { id: 'dns-1', type: 'A', name: '*.plugins.example.com', content: '192.0.2.1' } }),
    '/client/v4/zones/zone-1/workers/routes': (call) => call.method === 'GET'
      ? Response.json({ success: true, result: [] })
      : Response.json({ success: true, result: { id: 'route-1', pattern: '*.plugins.example.com/*', script: 'plugmesh-worker' } }),
  }, calls)

  const configured = await configureCloudflareDomain(TOKEN, ACCOUNT_A, '.plugins.example.com', fetchImpl)
  expect(configured).toEqual({ zoneId: 'zone-1', zoneName: 'example.com', hostname: '*.plugins.example.com', routePattern: '*.plugins.example.com/*' })
  expect(calls.map((call) => call.path)).toEqual([
    `/client/v4/zones?account.id=${ACCOUNT_A}&status=active&page=1&per_page=50`,
    '/client/v4/zones/zone-1/dns_records?name=*.plugins.example.com',
    '/client/v4/zones/zone-1/dns_records',
    '/client/v4/zones/zone-1/workers/routes',
    '/client/v4/zones/zone-1/workers/routes',
  ])
})

test('只有 rate_plan.id 为 free 时确认免费计划', async () => {
  const free = await readCloudflareSubscriptions(TOKEN, ACCOUNT_A, jsonFetcher({
    [`/client/v4/accounts/${ACCOUNT_A}/subscriptions`]: () => subscriptions('free'),
  }))
  expect(free.plan).toMatchObject({ free: true, confirmed: true })

  const paid = await readCloudflareSubscriptions(TOKEN, ACCOUNT_A, jsonFetcher({
    [`/client/v4/accounts/${ACCOUNT_A}/subscriptions`]: () => subscriptions('pro'),
  }))
  expect(paid.plan).toMatchObject({ free: false, confirmed: true })

  const unknown = await readCloudflareSubscriptions(TOKEN, ACCOUNT_A, jsonFetcher({
    [`/client/v4/accounts/${ACCOUNT_A}/subscriptions`]: () => subscriptions(null),
  }))
  expect(unknown.plan).toMatchObject({ free: false, confirmed: false })
})

test('API Token 加密保存、读取，并识别旧 OAuth 密文而不返回旧令牌', async () => {
  expect(await readStoredCloudflareCredential(testEnv)).toBeNull()
  const updatedAt = await storeCloudflareCredential(testEnv, {
    kind: 'api_token', apiToken: TOKEN, accountId: ACCOUNT_A, verifiedAt: '2026-10-23T00:00:00.000Z',
  })
  const stored = await readStoredCloudflareCredential(testEnv)
  expect(stored).toEqual({
    kind: 'api_token',
    credential: { kind: 'api_token', apiToken: TOKEN, accountId: ACCOUNT_A, verifiedAt: '2026-10-23T00:00:00.000Z' },
    updatedAt,
  })

  const legacy = await encryptSecret(testEnv.SESSION_SECRET!, JSON.stringify({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh', accountId: ACCOUNT_A }))
  await testEnv.DB.prepare('UPDATE cloudflare_credentials SET ciphertext = ?, iv = ?, updated_at = ? WHERE id = ?').bind(legacy.ciphertext, legacy.iv, updatedAt, 'primary').run()
  expect(await readStoredCloudflareCredential(testEnv)).toEqual({ kind: 'legacy_oauth', accountId: ACCOUNT_A, updatedAt })

  await deleteStoredCloudflareCredential(testEnv)
  expect(await readStoredCloudflareCredential(testEnv)).toBeNull()
})

test('CloudflareTokenError 保留 HTTP 状态和稳定错误码', () => {
  const error = new CloudflareTokenError(409, 'account_missing', 'missing')
  expect(error).toMatchObject({ status: 409, code: 'account_missing', message: 'missing' })
})
