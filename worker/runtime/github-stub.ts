// 测试用 GitHub OAuth 端点桩：按 OAuth code 返回固定身份，供 OAuth 路由用例使用。
const identities: Record<string, { id: number; login: string; name: string; email: string }> = {
  octocat: { id: 4242, login: 'octocat', name: 'Octo Cat', email: 'invitee@example.com' },
  stranger: { id: 777, login: 'stranger', name: 'Stranger', email: 'stranger@example.com' },
  'runtime-admin': { id: 1001, login: 'runtime-admin', name: 'Runtime Admin', email: 'admin@example.com' },
}

const identityFor = (code: string) => identities[code] ?? null

export async function githubStub(request: Request): Promise<Response> {
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
  return new Response(`unexpected outbound request: ${request.url}`, { status: 502 })
}
