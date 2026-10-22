import i18n from '../i18n'

export const currentLocale = () => i18n.resolvedLanguage ?? 'zh-CN'
export const formatDateTime = (value: string) => new Date(value).toLocaleString(currentLocale())
export const formatNumber = (value: number) => value.toLocaleString(currentLocale())

export function formatBytes(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(value / 1024)} KB`
}
