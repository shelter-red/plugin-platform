/** Cloudflare 授权回调诊断：保留 OAuth error 码与描述，避免只显示一句“授权未完成”。 */
export interface CloudflareDiagnosis {
  code: string | null
  message: string
  description: string | null
}

export function readCloudflareDiagnosis(search: string): CloudflareDiagnosis | null {
  const params = new URLSearchParams(search)
  const message = params.get('cloudflare_error')
  if (!message) return null
  return {
    code: params.get('cloudflare_error_code'),
    message,
    description: params.get('cloudflare_error_description'),
  }
}
