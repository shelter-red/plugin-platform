// 测试用出站端点桩：GitHub OAuth 与 Cloudflare API Token 接口，均按固定输入返回确定性结果。
const identities: Record<string, { id: number; login: string; name: string; email: string }> = {
  octocat: { id: 4242, login: 'octocat', name: 'Octo Cat', email: 'invitee@example.com' },
  stranger: { id: 777, login: 'stranger', name: 'Stranger', email: 'stranger@example.com' },
  'runtime-admin': { id: 1001, login: 'runtime-admin', name: 'Runtime Admin', email: 'admin@example.com' },
}

const identityFor = (code: string) => identities[code] ?? null

export const CLOUDFLARE_STUB_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
export const CLOUDFLARE_STUB_SECOND_ACCOUNT_ID = 'fedcba9876543210fedcba9876543210'
export const CLOUDFLARE_STUB_API_TOKEN = 'cf-api-token-runtime'
export const CLOUDFLARE_STUB_INVALID_TOKEN = 'cf-api-token-invalid'
export const CLOUDFLARE_STUB_PERMISSION_DENIED_TOKEN = 'cf-api-token-permission-denied'
export const CLOUDFLARE_STUB_MULTI_ACCOUNT_TOKEN = 'cf-api-token-multi-account'

function bearerToken(request: Request): string {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
}

function cloudflareTokenVerify(request: Request): Response {
  const token = bearerToken(request)
  if (!token || token === CLOUDFLARE_STUB_INVALID_TOKEN) return Response.json({ success: false, errors: [{ message: 'Invalid API Token' }] }, { status: 401 })
  return Response.json({ success: true, result: { id: 'token-runtime', status: 'active' } })
}

function cloudflareAccounts(request: Request): Response {
  const token = bearerToken(request)
  if (!token) return new Response('bad credentials', { status: 401 })
  if (token === CLOUDFLARE_STUB_PERMISSION_DENIED_TOKEN) return Response.json({ success: false, errors: [{ message: 'Account permission denied' }] }, { status: 403 })
  const accounts = token === CLOUDFLARE_STUB_MULTI_ACCOUNT_TOKEN
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
  if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token' && request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as { code?: string }
    const code = body.code ?? ''
    if (!identityFor(code)) return Response.json({ error: 'bad_verification_code' }, { status: 400 })
    return Response.json({ access_token: `access-${code}` })
  }
  if (url.hostname === 'api.github.com' && (url.pathname === '/user' || url.pathname === '/user/emails')) {
    const code = (request.headers.get('authorization') ?? '').replace(/^Bearer access-/, '')
    const identity = identityFor(code)
    if (!identity) return new Response('bad credentials', { status: 401 })
    if (url.pathname === '/user') return Response.json({ id: identity.id, login: identity.login, name: identity.name })
    return Response.json([
      { email: 'unverified@example.com', primary: true, verified: false },
      { email: identity.email, primary: true, verified: true },
    ])
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/accounts' && request.method === 'GET') return cloudflareAccounts(request)
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/user/tokens/verify' && request.method === 'GET') return cloudflareTokenVerify(request)
  if (url.hostname === 'api.cloudflare.com' && /^\/client\/v4\/accounts\/[^/]+\/subscriptions$/.test(url.pathname) && request.method === 'GET') return cloudflareSubscriptions(request)
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/graphql' && request.method === 'POST') {
    return Response.json({ data: { viewer: { accounts: [{ accountTag: CLOUDFLARE_STUB_ACCOUNT_ID }] } } })
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/zones' && request.method === 'GET') {
    return Response.json({ success: true, result: [{ id: 'zone-runtime', name: 'example.net', status: 'active' }], result_info: { page: 1, per_page: 50, count: 1, total_pages: 1 } })
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/zones/zone-runtime/dns_records') {
    if (request.method === 'GET') return Response.json({ success: true, result: [] })
    if (bearerToken(request) === CLOUDFLARE_STUB_MISSING_WRITE_TOKEN) return Response.json({ success: false, errors: [{ message: 'DNS write permission denied' }] }, { status: 403 })
    return Response.json({ success: true, result: { id: 'dns-runtime', type: 'A', name: url.searchParams.get('name') ?? '*.plugins.example.net', content: '192.0.2.1' } })
  }
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/zones/zone-runtime/workers/routes') {
    if (request.method === 'GET') return Response.json({ success: true, result: [] })
    if (bearerToken(request) === CLOUDFLARE_STUB_MISSING_WRITE_TOKEN) return Response.json({ success: false, errors: [{ message: 'Worker route permission denied' }] }, { status: 403 })
    return Response.json({ success: true, result: { id: 'route-runtime', pattern: '*.plugins.example.net/*', script: 'plugmesh-worker' } })
  }
  return new Response(`unexpected outbound request: ${request.url}`, { status: 502 })
}
