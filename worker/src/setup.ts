import { digest } from './auth'
import { normalizeOauthRedirectUri, parseGithubOAuthConfig, resolveOauthSettings, saveGithubOAuthSettings } from './oauth-settings'
import type { Env } from './types'

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

type SetupState = {
  userCount: number
  githubConfigured: boolean
  tokenRequired: boolean
  unavailable: boolean
}

type SetupValues = {
  clientId: string
  allowlist: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' },
  })
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...SECURITY_HEADERS, location },
  })
}

async function setupState(env: Env): Promise<SetupState> {
  const [users, oauth] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>(),
    resolveOauthSettings(env),
  ])
  const userCount = users?.count ?? 0
  const githubConfigured = Boolean(oauth.github)
  const tokenRequired = Boolean(env.SETUP_TOKEN)
  return {
    userCount,
    githubConfigured,
    tokenRequired,
    // 初始化令牌可以在首个用户诞生前修复配置；未设置令牌时，一旦已有 OAuth 配置就永久关闭入口。
    unavailable: userCount > 0 || (githubConfigured && !tokenRequired),
  }
}

async function constantTimeTokenMatch(expected: string, provided: string): Promise<boolean> {
  if (!expected || !provided) return false
  const [expectedHash, providedHash] = await Promise.all([digest(expected), digest(provided)])
  let difference = 0
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash.charCodeAt(index) ^ providedHash.charCodeAt(index)
  }
  return difference === 0
}

async function readForm(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) {
    const value = await request.json().catch(() => null)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, typeof item === 'string' ? item : '']))
  }
  const form = new URLSearchParams(await request.text().catch(() => ''))
  return Object.fromEntries(form.entries())
}

function setupPage(url: URL, state: SetupState, values: SetupValues, error = '', status = 200): Response {
  const homepage = normalizeOauthRedirectUri(url.origin)
  const callback = normalizeOauthRedirectUri(`${url.origin}/auth/github/callback`)
  const tokenField = state.tokenRequired
    ? `<label>部署令牌<input name="setupToken" type="password" autocomplete="off" required autofocus placeholder="查看 .wrangler/plugmesh-setup-token"></label>`
    : ''
  const configuredNotice = state.githubConfigured
    ? `<div class="notice">检测到已有 GitHub OAuth 配置。只有持有部署令牌时才能修改；首个用户创建后入口永久锁定。</div>`
    : ''
  const errorNotice = error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''
  return htmlResponse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plugmesh 初始化</title>
  <style>
    :root { color-scheme: dark; --bg:#09090b; --card:#18181b; --line:#3f3f46; --text:#fafafa; --muted:#a1a1aa; --accent:#10b981; --danger:#f87171; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:radial-gradient(circle at 50% 0%,#064e3b 0,var(--bg) 42%); color:var(--text); font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(620px,100%); padding:30px; border:1px solid var(--line); border-radius:10px; background:color-mix(in srgb,var(--card) 94%,transparent); box-shadow:0 24px 80px #0009; }
    h1 { margin:0 0 6px; font-size:24px; letter-spacing:-.02em; }
    p { margin:0 0 20px; color:var(--muted); }
    .badge { display:inline-block; margin-bottom:16px; padding:2px 8px; border:1px solid #065f46; border-radius:999px; color:#6ee7b7; background:#022c22; font-size:12px; }
    label { display:grid; gap:6px; margin:14px 0; color:#d4d4d8; font-weight:600; }
    input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:7px; background:#09090b; color:var(--text); font:inherit; }
    input:focus { outline:2px solid #059669; outline-offset:1px; border-color:transparent; }
    small { display:block; margin-top:5px; color:var(--muted); font-weight:400; }
    button { width:100%; margin-top:10px; padding:11px 14px; border:0; border-radius:7px; background:var(--accent); color:#022c22; font:700 14px inherit; cursor:pointer; }
    .notice,.error { margin:0 0 16px; padding:10px 12px; border-radius:7px; font-size:13px; }
    .notice { border:1px solid #52525b; background:#27272a; color:#e4e4e7; }
    .error { border:1px solid #7f1d1d; background:#450a0a; color:var(--danger); }
    code { color:#a7f3d0; }
    ol { margin:0 0 18px; padding-left:20px; color:var(--muted); }
    .fields { display:grid; gap:8px; }
    .fields div { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .fields span { color:var(--muted); font-size:12px; letter-spacing:.02em; }
    a { color:#6ee7b7; }
    li { margin:4px 0; }
  </style>
</head>
<body>
<main>
  <span class="badge">仅首次部署可用</span>
  <h1>初始化 Plugmesh</h1>
  <p>配置 GitHub OAuth 后，白名单中的第一个 GitHub 账号会成为超级管理员。Cloudflare OAuth 与 SMTP 等配置可在登录后进入后台继续填写。</p>
  ${configuredNotice}
  ${errorNotice}
  <ol>
    <li>打开 <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">GitHub → New OAuth App</a>（必须是 OAuth App，不是 GitHub App）。</li>
    <li>按下方两个地址填写 Homepage URL 与 Authorization callback URL，然后填写 Client ID、Client Secret 和管理员白名单。</li>
    <li>保存后按提示完成 GitHub 授权；创建首个用户后本页面永久锁定。</li>
  </ol>
  <div class="notice fields">
    <div><span>Homepage URL</span><code>${escapeHtml(homepage)}</code></div>
    <div><span>Authorization callback URL</span><code>${escapeHtml(callback)}</code></div>
  </div>
  <form method="post" action="/setup" autocomplete="off">
    ${tokenField}
    <label>GitHub Client ID<input name="clientId" required value="${escapeHtml(values.clientId)}" placeholder="Iv1.xxxxxxxxxxxxxxxx"></label>
    <label>GitHub Client Secret<input name="clientSecret" type="password" autocomplete="new-password" required placeholder="仅加密保存，不会回显"></label>
    <label>管理员白名单<input name="allowlist" required value="${escapeHtml(values.allowlist)}" placeholder="octocat, admin@example.com"><small>GitHub 用户名或已验证邮箱，逗号分隔。</small></label>
    <button type="submit">保存并登录 GitHub</button>
  </form>
</main>
</body>
</html>`, status)
}

export async function setupApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: SECURITY_HEADERS })
  const state = await setupState(env)
  if (state.unavailable) return new Response('Setup is not available', { status: 404, headers: SECURITY_HEADERS })
  if (!env.SESSION_SECRET) {
    return setupPage(url, state, { clientId: '', allowlist: '' }, 'SESSION_SECRET 未配置，无法安全保存 OAuth 凭据。请使用一键部署脚本或先写入该 Secret。', 503)
  }

  const values: SetupValues = { clientId: '', allowlist: '' }
  if (request.method === 'GET') return setupPage(url, state, values)

  const body = await readForm(request)
  values.clientId = body.clientId?.trim() ?? ''
  values.allowlist = body.allowlist?.trim() ?? ''

  if (state.tokenRequired && !await constantTimeTokenMatch(env.SETUP_TOKEN ?? '', body.setupToken ?? '')) {
    return setupPage(url, state, values, '部署令牌不正确。', 401)
  }

  const github = parseGithubOAuthConfig({
    clientId: values.clientId,
    clientSecret: body.clientSecret,
    redirectUri: normalizeOauthRedirectUri(`${url.origin}/auth/github/callback`),
    allowlist: values.allowlist,
  })
  if (!github || github.allowlist.length === 0) {
    return setupPage(url, state, values, '请填写完整的 GitHub OAuth 配置，并至少添加一个白名单账号。', 400)
  }

  try {
    await saveGithubOAuthSettings(env, github)
  } catch {
    return setupPage(url, state, values, 'OAuth 配置保存失败，请检查 SESSION_SECRET 与 D1 migration 是否已就绪。', 503)
  }
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), null, 'setup.github.configured', JSON.stringify({ clientId: github.clientId, allowlist: github.allowlist }), new Date().toISOString())
    .run()

  return redirect('/auth/github/start')
}
