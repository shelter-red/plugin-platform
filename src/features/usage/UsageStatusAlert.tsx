import { useTranslation } from 'react-i18next'
import { Alert, Button, Space } from 'antd'
import { ArrowUpRight, Cloud, RefreshCw, ShieldAlert } from 'lucide-react'
import type { CloudflareUsage } from '../../api'
import { translateError } from '../../errors'
import { formatDateTime } from '../../lib/format'

export function UsageStatusAlert({ usage, loading, refreshing, error, onRefresh, onOpenCloudflareSettings }: {
  usage: CloudflareUsage | null
  loading: boolean
  refreshing: boolean
  error: string | null
  onRefresh: () => void
  onOpenCloudflareSettings: () => void
}) {
  const { t } = useTranslation()
  const period = usage?.period
  const requests = usage?.requests
  const connected = usage?.configured === true && typeof requests === 'number'
  const accountMissing = usage?.configured === true && usage.accountIdConfigured === false
  const authorizationExpired = usage?.authorizationExpired === true
  const refresh = <Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button>
  const configureAction = <Space size={4} wrap>
    <Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.configure')} <ArrowUpRight size={14} /></Button>
    {refresh}
  </Space>

  if (error) {
    return <Alert type="error" showIcon message={t('usage.loadFailed')} description={<div className="alert-body"><span>{translateError(error)}</span><span>{t('usage.permissionHint')}</span></div>} action={<Space size={4} wrap><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.checkConfig')} <ArrowUpRight size={14} /></Button>{refresh}</Space>} />
  }
  if (authorizationExpired) {
    return <Alert type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('usage.authorizationExpired')} description={<div className="alert-body"><span>{t('usage.authorizationExpiredHint')}</span></div>} action={<Space size={4} wrap><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.reauthorize')} <ArrowUpRight size={14} /></Button>{refresh}</Space>} />
  }
  if (accountMissing) {
    return <Alert type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('usage.accountMissing')} description={<div className="alert-body"><span>{t('usage.accountMissingHint')}</span><span>{t('usage.permissionHint')}</span></div>} action={<Space size={4} wrap><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.checkConfig')} <ArrowUpRight size={14} /></Button>{refresh}</Space>} />
  }
  return <Alert
    type={connected ? 'success' : 'info'}
    showIcon
    icon={<Cloud size={16} />}
    message={loading ? t('usage.loadingOfficial') : connected ? t('usage.connected') : t('usage.notConnected')}
    description={connected && period ? t('usage.period', { start: formatDateTime(period.start), end: formatDateTime(period.end) }) : <div className="alert-body"><span>{t('usage.periodHint')}</span><span>{t('usage.localIndependentHint')}</span></div>}
    action={configureAction}
  />
}
