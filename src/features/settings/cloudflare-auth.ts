/**
 * Cloudflare 授权回跳诊断：Worker 只回传稳定错误码与 Cloudflare 原始描述，
 * 文案由前端按错误码渲染，避免把可变长句塞进 URL 或 Cookie。
 */
export interface CloudflareDiagnosis {
  code: string
  description: string | null
}

/** 与 worker/src/index.ts 的 Cloudflare 回调错误码保持一致。 */
const diagnosisCodes = ['access_denied', 'invalid_scope', 'invalid_client', 'session_required', 'invalid_callback', 'state_expired', 'token_exchange_failed', 'secret_missing', 'account_missing'] as const
export type CloudflareDiagnosisCode = (typeof diagnosisCodes)[number]

const isDiagnosisCode = (value: string): value is CloudflareDiagnosisCode => (diagnosisCodes as readonly string[]).includes(value)

export function diagnosisMessageKey(code: string | null): string {
  return code && isDiagnosisCode(code) ? `settings.cloudflare.diagnosis.${code}` : 'settings.cloudflare.diagnosis.generic'
}

/** 需要引导管理员回 Cloudflare OAuth 客户端补权限的错误码。 */
export function diagnosisNeedsPermissions(code: string | null): boolean {
  return code === 'invalid_scope' || code === 'account_missing'
}

/** 固定权限清单的前端兜底：Worker 未加载时也能显示，避免出现空白或可编辑状态。 */
export const CLOUDFLARE_SCOPE_FALLBACK: Record<string, string> = {
  'account-settings.read': 'Account Settings Read',
  'account-analytics.read': 'Account Analytics Read',
  offline_access: 'Offline Access',
}
