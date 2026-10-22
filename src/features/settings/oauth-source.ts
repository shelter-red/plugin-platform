import type { OauthSource } from '../../api'
import type { StatusTone } from '../../components/StatusBadge'

export function oauthSourceTone(source: OauthSource): StatusTone {
  return source === 'database' ? 'success' : source === 'environment' ? 'warning' : 'neutral'
}

export function oauthSourceLabel(source: OauthSource, t: (key: string) => string): string {
  return source === 'database' ? t('settings.oauth.sourceDatabase') : source === 'environment' ? t('settings.oauth.sourceEnvironment') : t('settings.oauth.sourceNone')
}
