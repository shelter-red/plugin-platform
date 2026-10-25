import { beforeEach, expect, test } from 'vitest'
import { CloudflareCredentialError, configureCloudflareDomain, deleteStoredCloudflareCredential, listCloudflareAccounts, readCloudflareSubscriptions, readStoredCloudflareCredential, selectCloudflareAccountId, storeCloudflareCredential, validateCloudflareCredential, verifyCloudflareGlobalApiKey } from '../src/cloudflare-credentials'
import { encryptSecret } from '../src/secrets'
import { resetDatabase, testEnv } from './helpers'

const EMAIL = 'admin@example.com'
const KEY = 'global-api-key-secret'
const AUTH = { email: EMAIL, globalApiKey: KEY }
const ACCOUNT_A = '0123456789abcdef0123456789abcdef'
const ACCOUNT_B = 'fedcba9876543210fedcba9876543210'

type Call = { path: string; email: string | null; key: string | null; method: string }

function jsonFetcher(routes: Record<string, (call: Call) => Response>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    const call = { path: `${url.pathname}${url.search}`, email: request.headers.get('X-Auth-Email'), key: request.headers.get('X-Auth-Key'), method: request.method }
    calls.push(call)
    return routes[call.path]?.(call) ?? new Response(`unexpected request: ${call.path}`, { status: 500 })
  }) as typeof fetch
}

function accountPage(ids: string[], page: number, totalPages: number): Response {
  return Response.json({ success: true, result: ids.map((id, index) => ({ id, name: `Account ${page}-${index}` })), result_info: { page, per_page: 50, count: ids.length, total_pages: totalPages } })
}

function subscriptions(planId: string | null, state = 'active'): Response {
  return Response.json({ success: true, result: [{ id: 'sub-1', state, rate_plan: planId ? { id: planId, public_name: 'Plan' } : undefined }] })
}

beforeEach(async () => { await resetDatabase() })

test('Global API Key 请求使用 Email 和 X-Auth-Key，并验证账号和订阅', async () => {
  const calls: Call[] = []
  const fetchImpl = jsonFetcher({
    '/client/v4/user': () => Response.json({ success: true, result: { id: 'user-1' } }),
    '/client/v4/accounts?page=1&per_page=50': () => accountPage([ACCOUNT_A], 1, 2),
    '/client/v4/accounts?page=2&per_page=50': () => accountPage([ACCOUNT_B], 2, 2),
    [`/client/v4/accounts/${ACCOUNT_B}/subscriptions`]: () => subscriptions('free'),
  }, calls)
  const result = await validateCloudflareCredential(EMAIL, KEY, ACCOUNT_B, fetchImpl)
  expect(result.credential).toMatchObject({ kind: 'global_api_key', email: EMAIL, globalApiKey: KEY, accountId: ACCOUNT_B })
  expect(result.subscriptions.plan).toMatchObject({ id: 'free', free: true, confirmed: true })
  expect(calls.every((call) => call.email === EMAIL && call.key === KEY)).toBe(true)
  expect(calls.some((call) => call.key === KEY && call.path.includes('tokens/verify'))).toBe(false)
})

test('多账号返回可选择列表，错误凭据和拒绝请求使用稳定错误码', async () => {
  const fetchImpl = jsonFetcher({
    '/client/v4/user': () => Response.json({ success: false, errors: [{ message: 'Invalid global key' }] }, { status: 401 }),
  })
  await expect(verifyCloudflareGlobalApiKey(AUTH, fetchImpl)).rejects.toMatchObject({ status: 401, code: 'credential_invalid' })
  await expect(listCloudflareAccounts(AUTH, jsonFetcher({
    '/client/v4/accounts?page=1&per_page=50': () => Response.json({ success: false, errors: [{ message: 'Denied' }] }, { status: 403 }),
  }))).rejects.toMatchObject({ status: 403, code: 'credential_denied' })
})

test('未选择账号时保留账号选项，指定不可见账号返回 account_missing', async () => {
  const fetchImpl = jsonFetcher({
    '/client/v4/user': () => Response.json({ success: true, result: { id: 'user-1' } }),
    '/client/v4/accounts?page=1&per_page=50': () => accountPage([ACCOUNT_A, ACCOUNT_B], 1, 1),
  })
  await expect(validateCloudflareCredential(EMAIL, KEY, undefined, fetchImpl)).rejects.toMatchObject({ status: 409, code: 'account_ambiguous', accounts: [{ id: ACCOUNT_A }, { id: ACCOUNT_B }] })
  await expect(validateCloudflareCredential(EMAIL, KEY, 'missing', fetchImpl)).rejects.toMatchObject({ status: 409, code: 'account_missing' })
  expect(() => selectCloudflareAccountId([], undefined)).toThrow('没有可见的 Cloudflare 账号')
})

test('Global API Key 自动配置 Zone、通配 DNS 和 Worker Route', async () => {
  const fetchImpl = jsonFetcher({
    [`/client/v4/zones?account.id=${ACCOUNT_A}&status=active&page=1&per_page=50`]: () => Response.json({ success: true, result: [{ id: 'zone-1', name: 'example.com', status: 'active' }], result_info: { total_pages: 1 } }),
    '/client/v4/zones/zone-1/dns_records?name=*.plugins.example.com': () => Response.json({ success: true, result: [] }),
    '/client/v4/zones/zone-1/dns_records': () => Response.json({ success: true, result: { id: 'dns-1' } }),
    '/client/v4/zones/zone-1/workers/routes': (call) => call.method === 'GET' ? Response.json({ success: true, result: [] }) : Response.json({ success: true, result: { id: 'route-1' } }),
  })
  await expect(configureCloudflareDomain(AUTH, ACCOUNT_A, '.plugins.example.com', fetchImpl)).resolves.toMatchObject({ zoneId: 'zone-1', hostname: '*.plugins.example.com' })
})

test('已取消、失败或过期的 Free 订阅不提供免费额度基线', async () => {
  for (const state of ['Cancelled', 'Failed', 'Expired']) {
    const result = await readCloudflareSubscriptions(AUTH, ACCOUNT_A, jsonFetcher({ [`/client/v4/accounts/${ACCOUNT_A}/subscriptions`]: () => subscriptions('free', state) }))
    expect(result.plan).toMatchObject({ id: 'free', free: false, confirmed: true })
  }
})

  expect((await readCloudflareSubscriptions(AUTH, ACCOUNT_A, jsonFetcher({ [`/client/v4/accounts/${ACCOUNT_A}/subscriptions`]: () => subscriptions('pro') })) ).plan.free).toBe(false)
  const updatedAt = await storeCloudflareCredential(testEnv, { kind: 'global_api_key', email: EMAIL, globalApiKey: KEY, accountId: ACCOUNT_A, verifiedAt: '2026-10-24T00:00:00.000Z' })
  expect(await readStoredCloudflareCredential(testEnv)).toEqual({ kind: 'global_api_key', credential: { kind: 'global_api_key', email: EMAIL, globalApiKey: KEY, accountId: ACCOUNT_A, verifiedAt: '2026-10-24T00:00:00.000Z' }, updatedAt })
  const legacy = await encryptSecret(testEnv.SESSION_SECRET!, JSON.stringify({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }))
  await testEnv.DB.prepare('UPDATE cloudflare_credentials SET ciphertext = ?, iv = ? WHERE id = ?').bind(legacy.ciphertext, legacy.iv, 'primary').run()
  await expect(readStoredCloudflareCredential(testEnv)).rejects.toMatchObject({ status: 409 })
  await deleteStoredCloudflareCredential(testEnv)
  expect(await readStoredCloudflareCredential(testEnv)).toBeNull()
})

test('Cloudflare 错误保留 HTTP 状态和稳定错误码', () => {
  const error = new CloudflareCredentialError(409, 'account_missing', 'missing')
  expect(error).toMatchObject({ status: 409, code: 'account_missing', message: 'missing' })
})
