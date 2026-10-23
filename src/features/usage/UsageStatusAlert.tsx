import { useTranslation } from 'react-i18next'
import { Alert, Button } from 'antd'
import { ArrowUpRight, Cloud, ShieldAlert } from 'lucide-react'
import type { CloudflareUsage } from '../../api'
import { translateError } from '../../errors'
import { formatDateTime } from '../../lib/format'

export function UsageStatusAlert({ usage, loading, error, onOpenCloudflareSettings }: {
  usage: CloudflareUsage | null
  loading: boolean
  error: string | null
  onOpenCloudflareSettings: () => void
}) {
  const { t } = useTranslation()
  const period = usage?.period
  const connected = usage?.configured === true
  const accountMissing = connected && usage.accountIdConfigured === false
  const legacyCredential = usage?.legacyCredential === true
  const officialError = usage?.error ?? null
  const configureAction = <Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.configure')} <ArrowUpRight size={14} /></Button>

  if (legacyCredential) {
    return <Alert type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('usage.legacyCredential')} description={<div className="alert-body"><span>{t('usage.legacyCredentialHint')}</span></div>} action={configureAction} />
  }
  if (error || officialError) {
    return <Alert type="error" showIcon message={t('usage.loadFailed')} description={<div className="alert-body"><span>{translateError(error ?? officialError ?? '')}</span><span>{t('usage.permissionHint')}</span></div>} action={configureAction} />
  }
  if (accountMissing) {
    return <Alert type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('usage.accountMissing')} description={<div className="alert-body"><span>{t('usage.accountMissingHint')}</span><span>{t('usage.permissionHint')}</span></div>} action={configureAction} />
  }
  return <Alert
    type={connected ? 'success' : 'info'}
    showIcon
    icon={<Cloud size={16} />}
    message={loading ? t('usage.loadingOfficial') : connected ? t('usage.connected') : t('usage.notConnected')}
    description={connected && period
      ? t('usage.period', { start: formatDateTime(period.start), end: formatDateTime(period.end) })
      : <div className="alert-body"><span>{t('usage.periodHint')}</span><span>{t('usage.localIndependentHint')}</span></div>}
    action={connected ? undefined : configureAction}
  />
}
