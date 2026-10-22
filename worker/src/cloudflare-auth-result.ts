/**
 * Cloudflare 授权回跳结果通过一次性 HttpOnly Cookie 传给控制台：
 * 回调失败时不再把错误码塞进 URL，也不会把用户丢在首页。
 * Cookie 只保存稳定错误码与 Cloudflare 原始描述，文案由前端 i18n 渲染。
 */
export type CloudflareAuthResult =
  | { kind: 'error'; code: string; description: string | null }
  | { kind: 'success'; accountConfigured: boolean }

const COOKIE_NAME = 'plugmesh_cf_auth'
const MAX_AGE_SECONDS = 120

export function cloudflareAuthResultCookie(result: CloudflareAuthResult, secure: boolean): string {
  const value = encodeURIComponent(JSON.stringify(result))
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`
}

export function clearCloudflareAuthResultCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export function readCloudflareAuthResult(request: Request): CloudflareAuthResult | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key !== COOKIE_NAME) continue
    try {
      const parsed = JSON.parse(decodeURIComponent(rest.join('='))) as Partial<CloudflareAuthResult> & { kind?: string }
      if (parsed.kind === 'success') return { kind: 'success', accountConfigured: Boolean(parsed.accountConfigured) }
      if (parsed.kind === 'error' && typeof parsed.code === 'string' && parsed.code) {
        return { kind: 'error', code: parsed.code, description: typeof parsed.description === 'string' ? parsed.description : null }
      }
    } catch {
      return null
    }
  }
  return null
}
