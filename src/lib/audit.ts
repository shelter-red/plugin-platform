import type { ApiAudit } from '../api'
import i18n from '../i18n'

export function auditActionLabel(action: string): string {
  return i18n.t(`auditActions.${action}`, { defaultValue: action })
}

export function auditDetail(item: ApiAudit): string {
  try {
    const details = JSON.parse(item.detail_json) as Record<string, unknown>
    const values = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== '')
    return values.length > 0 ? values.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ') : '—'
  } catch {
    return item.detail_json || '—'
  }
}
