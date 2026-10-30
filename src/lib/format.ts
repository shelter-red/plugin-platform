import i18n from '../i18n'

export const currentLocale = () => i18n.resolvedLanguage ?? 'zh-CN'
export const formatDateTime = (value: string) => new Date(value).toLocaleString(currentLocale())
export const formatNumber = (value: number) => value.toLocaleString(currentLocale())

export function formatBytes(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2
  const formatted = amount.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/g, '')
  return `${formatted} ${units[unitIndex]}`
}
