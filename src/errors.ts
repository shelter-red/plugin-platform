import { ApiError } from './api'
import i18n from './i18n'

export const translateError = (value: string) => i18n.exists(value) ? i18n.t(value) : value

const httpErrorKey = (status: number) => {
  if (status === 401) return 'toast.http.unauthorized'
  if (status === 403) return 'toast.http.forbidden'
  if (status === 404) return 'toast.http.notFound'
  if (status === 409) return 'toast.http.conflict'
  if (status === 429) return 'toast.http.rateLimited'
  if (status >= 500) return 'toast.http.serverError'
  return 'toast.http.failed'
}

// Worker 的错误文本是面向开发的英文；除非服务端已给出中文提示，否则统一换成按状态码本地化的文案。
export function errorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError) {
    if (/[\u4e00-\u9fa5]/.test(error.message)) return error.message
    return i18n.t(httpErrorKey(error.status))
  }
  if (error instanceof Error && i18n.exists(error.message)) return i18n.t(error.message)
  return i18n.t(fallbackKey)
}
