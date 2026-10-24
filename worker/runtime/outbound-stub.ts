// 测试用出站端点桩：Cloudflare Global API Key 接口按固定输入返回确定性结果。
export const CLOUDFLARE_STUB_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
export const CLOUDFLARE_STUB_SECOND_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210'
export const CLOUDFLARE_STUB_EMAIL = 'admin@example.com'
export const CLOUDFLARE_STUB_GLOBAL_API_KEY = 'cf-global-key-runtime'
export const CLOUDFLARE_STUB_INVALID_GLOBAL_API_KEY = 'cf-global-key-invalid'
export const CLOUDFLARE_STUB_PERMISSION_DENIED_GLOBAL_API_KEY = 'cf-global-key-permission-denied'
export const CLOUDFLARE_STUB_MULTI_ACCOUNT_GLOBAL_API_KEY = 'cf-global-key-multi-account'
export const CLOUDFLARE_STUB_MISSING_WRITE_GLOBAL_API_KEY = 'cf-global-key-missing-write'

function globalApiKey(request: Request): string {
  return request.headers.get('X-Auth-Key') ?? ''
}

function cloudflareUser(request: Request): Response {
  const key = globalApiKey(request)
  if (!request.headers.get('X-Auth-Email') || !key || key === CLOUDFLARE_STUB_INVALID_GLOBAL_API_KEY) return Response.json({ success: false, errors: [{ message: 'Invalid Global API Key' }] }, { status: 401 })
  return Response.json({ success: true, result: { id: 'user-runtime' } })
}

function cloudflareAccounts(request: Request): Response {
  const key = globalApiKey(request)
  if (!key) return new Response('bad credentials', { status: 401 })
  if (key === CLOUDFLARE_STUB_PERMISSION_DENIED_GLOBAL_API_KEY) return Response.json({ success: false, errors: [{ message: 'Account access denied' }] }, { status: 403 })
  const accounts = key === CLOUDFLARE_STUB_MULTI_ACCOUNT_GLOBAL_API_KEY
    ? [CLOUDFLARE_STUB_ACCOUNT_ID, CLOUDFLARE_STUB_SECOND_ACCOUNT_ID]
    : [CLOUDFLARE_STUB_ACCOUNT_ID]
  return Response.json({
    success: true,
    result: accounts.map((id, index) => ({ id, name: `Runtime Account ${index + 1}` })),
    result_info: { page: 1, per_page: 50, count: accounts.length, total_pages: 1 },
  })
}

function cloudflareSubscriptions(request: Request): Response {
  const accountId = new URL(request.url).pathname.split('/')[4]
  if (accountId !== CLOUDFLARE_STUB_ACCOUNT_ID && accountId !== CLOUDFLARE_STUB_SECOND_ACCOUNT_ID) {
    return Response.json({ success: false, errors: [{ message: 'Account not found' }] }, { status: 404 })
  }
  return Response.json({
    success: true,
    result: [{ id: 'subscription-runtime', state: 'active', rate_plan: { id: 'free', public_name: 'Free Website' } }],
    errors: [],
    messages: [],
  })
}

export async function outboundStub(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/accounts' && request.method === 'GET') return cloudflareAccounts(request)
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/user' && request.method === 'GET') return cloudflareUser(request)
  if (url.hostname === 'api.cloudflare.com' && /^\/client\/v4\/accounts\/[^/]+\/subscriptions$/.test(url.pathname) && request.method === 'GET') return cloudflareSubscriptions(request)
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/graphql' && request.method === 'POST') {
    return Response.json({ data: { viewer: { accounts: [{ accountTag: CLOUDFLARE_STUB_ACCOUNT_ID }] } } })
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/zones' && request.method === 'GET') {
    return Response.json({ success: true, result: [{ id: 'zone-runtime', name: 'example.net', status: 'active' }], result_info: { page: 1, per_page: 50, count: 1, total_pages: 1 } })
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/zones/zone-runtime/dns_records') {
    if (request.method === 'GET') return Response.json({ success: true, result: [] })
    if (globalApiKey(request) === CLOUDFLARE_STUB_MISSING_WRITE_GLOBAL_API_KEY) return Response.json({ success: false, errors: [{ message: 'DNS write access denied' }] }, { status: 403 })
    return Response.json({ success: true, result: { id: 'dns-runtime', type: 'A', name: url.searchParams.get('name') ?? '*.plugins.example.net', content: '192.0.2.1' } })
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/zones/zone-runtime/workers/routes') {
    if (request.method === 'GET') return Response.json({ success: true, result: [] })
    if (globalApiKey(request) === CLOUDFLARE_STUB_MISSING_WRITE_GLOBAL_API_KEY) return Response.json({ success: false, errors: [{ message: 'Worker route access denied' }] }, { status: 403 })
    return Response.json({ success: true, result: { id: 'route-runtime', pattern: '*.plugins.example.net/*', script: 'plugmesh-worker' } })
  }
  return new Response(`unexpected outbound request: ${request.url}`, { status: 502 })
}
