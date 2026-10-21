// 测试用出站端点桩：GitHub OAuth 与 Cloudflare OAuth 令牌端点，均按固定输入返回确定性结果。
const identities: Record<string, { id: number; login: string; name: string; email: string }> = {
  octocat: { id: 4242, login: 'octocat', name: 'Octo Cat', email: 'invitee@example.com' },
  stranger: { id: 777, login: 'stranger', name: 'Stranger', email: 'stranger@example.com' },
  'runtime-admin': { id: 1001, login: 'runtime-admin', name: 'Runtime Admin', email: 'admin@example.com' },
}

const identityFor = (code: string) => identities[code] ?? null

export const CLOUDFLARE_STUB_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
export const CLOUDFLARE_STUB_REFRESHED_TOKEN = 'cf-access-refreshed'

async function cloudflareToken(request: Request): Promise<Response> {
  const form = new URLSearchParams(await request.text())
  const grantType = form.get('grant_type') ?? ''
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? ''
    if (!code) return Response.json({ error: 'invalid_request' }, { status: 400 })
    return Response.json({ access_token: `cf-access-${code}`, refresh_token: 'refresh-ok', token_type: 'Bearer', expires_in: 3600 })
  }
  if (grantType !== 'refresh_token') return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
  const token = form.get('refresh_token') ?? ''
  if (token !== 'refresh-ok' && token !== 'refresh-ok-next') return Response.json({ error: 'invalid_grant' }, { status: 400 })
  return Response.json({ access_token: CLOUDFLARE_STUB_REFRESHED_TOKEN, refresh_token: 'refresh-ok-next', token_type: 'Bearer', expires_in: 3600 })
}

async function cloudflareAccounts(request: Request): Promise<Response> {
  const authorized = (request.headers.get('authorization') ?? '').startsWith('Bearer ')
  if (!authorized) return new Response('bad credentials', { status: 401 })
  return Response.json({ result: [{ id: CLOUDFLARE_STUB_ACCOUNT_ID }] })
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
  if (url.hostname === 'dash.cloudflare.com' && url.pathname === '/oauth2/token' && request.method === 'POST') return cloudflareToken(request)
  if (url.hostname === 'dash.cloudflare.com' && url.pathname === '/oauth2/revoke' && request.method === 'POST') return Response.json({ success: true })
  if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/accounts' && request.method === 'GET') return cloudflareAccounts(request)
  return new Response(`unexpected outbound request: ${request.url}`, { status: 502 })
}
