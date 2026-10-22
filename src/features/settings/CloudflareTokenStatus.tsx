import { Alert } from 'antd'
import { KeyRound, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import { formatDateTime } from '../../lib/format'

/** 已保存 Token 的状态摘要；账号 ID 和 Token 都不会以明文回显。 */
export function CloudflareTokenStatus({ settings, apiLive }: { settings: CloudflareSettings | null; apiLive: boolean }) {
  const { t } = useTranslation()
  if (!settings) {
    return <Alert className="oauth-notice" type={apiLive ? 'error' : 'info'} showIcon icon={<ShieldAlert size={16} />} message={apiLive ? t('settings.cloudflare.loadFailed') : t('settings.cloudflare.disconnected')} description={t('settings.cloudflare.disconnectedHint')} />
  }
  if (settings.legacyCredential) {
    return <Alert className="oauth-notice" type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('settings.cloudflare.legacyTitle')} description={t('settings.cloudflare.legacyHint')} />
  }
  if (!settings.configured) {
    return <Alert className="oauth-notice" type="info" showIcon icon={<KeyRound size={16} />} message={t('settings.cloudflare.notConfigured')} description={t('settings.cloudflare.notConfiguredHint')} />
  }
  return <div className="form-grid">
    <div className="field">
      <span className="field-label">{t('settings.cloudflare.accountId')}</span>
      <span className="field-value">{settings.accountId ?? t('common.notRead')}</span>
      <span className="field-hint">{t('settings.cloudflare.accountHint')}</span>
    </div>
    <div className="field">
      <span className="field-label">{t('settings.cloudflare.credentialKind')}</span>
      <span className="field-value">{t('settings.cloudflare.apiToken')}</span>
      <span className="field-hint">{settings.lastVerifiedAt ? t('settings.cloudflare.lastVerified', { time: formatDateTime(settings.lastVerifiedAt) }) : t('settings.cloudflare.notVerified')}</span>
    </div>
  </div>
}
