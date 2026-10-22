import type { AuthErrorCode } from './auth'

/**
 * GitHub 登录回调失败直接返回 HTTP 错误状态与可读页面，
 * 不再 302 到 `/?auth_error=...`：错误语义属于 HTTP 状态码，而不是查询参数。
 */
const definitions: Record<AuthErrorCode, { status: number; zh: string; en: string }> = {
  callback_incomplete: { status: 400, zh: 'GitHub 未返回完整的回调参数，请重新登录。', en: 'GitHub did not return the full callback parameters. Please sign in again.' },
  state_expired: { status: 409, zh: '登录链接已过期，请重新登录。', en: 'This sign-in link has expired. Please sign in again.' },
  state_used: { status: 409, zh: '登录链接已被使用，请重新登录。', en: 'This sign-in link was already used. Please sign in again.' },
  oauth_not_configured: { status: 503, zh: 'GitHub 登录尚未配置，请联系管理员补全 Client ID 与 Client Secret。', en: 'GitHub sign-in is not configured. Ask an administrator to set the client ID and secret.' },
  token_exchange_failed: { status: 502, zh: 'GitHub 授权码换取令牌失败，请检查 Client ID、Client Secret 与回调地址是否一致。', en: 'GitHub rejected the authorization code. Check the client ID, client secret and callback URL.' },
  user_api_failed: { status: 502, zh: '读取 GitHub 用户信息失败，请稍后重试。', en: 'Reading the GitHub user profile failed. Try again later.' },
  email_api_failed: { status: 502, zh: '读取 GitHub 邮箱失败，请确认 OAuth App 已授权 user:email 权限。', en: 'Reading GitHub emails failed. Make sure the OAuth App can request the user:email scope.' },
  identity_incomplete: { status: 502, zh: 'GitHub 返回的身份信息不完整，缺少用户 ID 或登录名。', en: 'GitHub returned an incomplete identity: the user ID or login is missing.' },
  email_unverified: { status: 403, zh: '该 GitHub 账号没有已验证的邮箱，请先在 GitHub 完成邮箱验证。', en: 'This GitHub account has no verified email. Verify an email on GitHub first.' },
  invite_mismatch: { status: 403, zh: '邀请身份不匹配或已失效，请联系邀请人重新发送。', en: 'The invite does not match this identity or has expired. Ask for a new invite.' },
  invite_required: { status: 403, zh: '该 GitHub 身份未被邀请，无法登录。', en: 'This GitHub identity has not been invited and cannot sign in.' },
}

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function authErrorResponse(request: Request, code: AuthErrorCode): Response {
  const definition = definitions[code]
  const prefersChinese = /(^|,)\s*zh(-|,|;|$)/i.test(request.headers.get('accept-language') ?? '')
  const title = prefersChinese ? '登录失败' : 'Sign-in failed'
  const message = prefersChinese ? definition.zh : definition.en
  const hint = prefersChinese
    ? '返回登录页后重新发起 GitHub 登录；如果问题持续，请联系平台管理员。'
    : 'Return to the sign-in page and start GitHub sign-in again. If it keeps failing, contact your administrator.'
  const back = prefersChinese ? '返回登录' : 'Back to sign-in'
  const html = `<!doctype html>
<html lang="${prefersChinese ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Plugmesh</title>
<style>
:root { color-scheme: light dark; --bg: #f7f7f8; --panel: #fff; --text: #18181b; --muted: #52525b; --line: rgba(24,24,27,.12); --accent: #047857; }
@media (prefers-color-scheme: dark) { :root { --bg: #09090b; --panel: #111113; --text: #f4f4f5; --muted: #a1a1aa; --line: rgba(255,255,255,.12); --accent: #34d399; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.6 ui-sans-serif, system-ui, sans-serif; }
main { width: min(420px, 100%); padding: 28px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
span.code { display: inline-block; margin-bottom: 12px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 4px; color: var(--muted); font: 11px/1.6 ui-monospace, monospace; }
h1 { margin: 0 0 10px; font-size: 20px; }
p { margin: 0 0 10px; color: var(--muted); }
a { display: inline-block; margin-top: 8px; color: var(--accent); font-weight: 600; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
<span class="code">${escapeHtml(code)}</span>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<p>${escapeHtml(hint)}</p>
<a href="/">${escapeHtml(back)}</a>
</main>
</body>
</html>`
  return new Response(html, {
    status: definition.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  })
}
