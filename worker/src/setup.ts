import { AdminPasswordSetupError, MIN_PASSWORD_LENGTH, setAdminPassword, type AdminPasswordState } from './auth'
import type { Env } from './types'

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' } })
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

async function readForm(request: Request): Promise<Record<string, string>> {
  const body = await request.text().catch(() => '')
  return Object.fromEntries(new URLSearchParams(body).entries())
}

function setupPage(error = '', status = 200, formEnabled = true): Response {
  const errorNotice = error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''
  const description = formEnabled
    ? `首次使用请设置管理员密码。密码至少 ${MIN_PASSWORD_LENGTH} 个字符，设置完成后使用该密码登录。`
    : '数据库迁移尚未完成。请先应用 D1 migration，再刷新此页面。'
  const form = formEnabled
    ? `<form method="post" action="/setup" autocomplete="off"><label>管理员密码<input name="password" type="password" autocomplete="new-password" required autofocus minlength="${MIN_PASSWORD_LENGTH}"></label><label>确认密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}"></label><small>密码只保存为加盐哈希，不会明文保存。</small><button type="submit">保存密码</button></form>`
    : ''
  return htmlResponse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>初始化 Plugmesh</title>
<style>:root{color-scheme:dark;--bg:#09090b;--card:#18181b;--line:#3f3f46;--text:#fafafa;--muted:#a1a1aa;--accent:#10b981;--danger:#f87171}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(480px,100%);padding:30px;border:1px solid var(--line);border-radius:10px;background:var(--card);box-shadow:0 24px 80px #0009}h1{margin:0 0 6px;font-size:24px}p{margin:0 0 20px;color:var(--muted)}label{display:grid;gap:6px;margin:14px 0;color:#d4d4d8;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:7px;background:#09090b;color:var(--text);font:inherit}button{width:100%;margin-top:10px;padding:11px 14px;border:0;border-radius:7px;background:var(--accent);color:#022c22;font:700 14px inherit;cursor:pointer}.error{margin:0 0 16px;padding:10px 12px;border:1px solid #7f1d1d;border-radius:7px;background:#450a0a;color:var(--danger)}small{color:var(--muted);font-weight:400}</style></head>
<body><main><h1>初始化 Plugmesh</h1><p>${description}</p>${errorNotice}${form}</main></body></html>`, status)
}

export async function setupApi(request: Request, env: Env, passwordState: AdminPasswordState): Promise<Response | null> {
  if (passwordState === 'configured') return null
  if (passwordState === 'migration_required') return setupPage('', 503, false)
  if (request.method === 'GET') return setupPage()
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: SECURITY_HEADERS })
  const body = await readForm(request)
  const password = body.password ?? ''
  const confirmPassword = body.confirmPassword ?? ''
  if (password.length < MIN_PASSWORD_LENGTH) return setupPage(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`, 400)
  if (password !== confirmPassword) return setupPage('两次输入的密码不一致。', 400)
  try {
    await setAdminPassword(env, password)
  } catch (error) {
    const errorId = request.headers.get('cf-ray') ?? crypto.randomUUID()
    const code = error instanceof AdminPasswordSetupError ? error.code : 'unexpected_error'
    console.error('Admin password setup failed', {
      errorId,
      code,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    const message = code === 'password_derivation_failed'
      ? '当前运行环境无法安全处理管理员密码。'
      : '管理员密码暂时无法保存，请稍后重试。'
    return setupPage(`${message} 错误编号：${errorId}`, 503)
  }
  return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, location: '/' } })
}
