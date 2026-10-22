import { useTranslation } from 'react-i18next'
import { Button, Space } from 'antd'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import type { CloudflareUsage, LocalUsage } from '../../api'
import { Panel } from '../../components/Panel'
import { formatDateTime } from '../../lib/format'

export function UsageSourcesPanel({ usage, localUsage, refreshing, onRefresh, onOpenCloudflareSettings }: {
  usage: CloudflareUsage | null
  localUsage: LocalUsage | null
  refreshing: boolean
  onRefresh: () => void
  onOpenCloudflareSettings: () => void
}) {
  const { t } = useTranslation()
  const connected = usage?.configured === true && typeof usage.requests === 'number'
  const hasLocalUsage = localUsage !== null
  return <Panel title={t('usage.sourcesTitle')} subtitle={t('usage.sourcesSubtitle')}>
    <div className="source-row"><span className="source-name"><span className={`source-dot ${connected ? 'green' : 'pending'}`} />Cloudflare Analytics API</span><span className="muted">{connected ? `${usage?.cached ? t('usage.cached') : t('usage.latest')} · ${usage.updatedAt ? formatDateTime(usage.updatedAt) : t('usage.unknownTime')}` : t('usage.notConfigured')}</span><Space size={0}><Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.configureSource')} <ArrowUpRight size={14} /></Button></Space></div>
    <div className="source-row"><span className="source-name"><span className={`source-dot ${hasLocalUsage ? 'green' : 'pending'}`} />{t('overview.note.localCount')}</span><span className="muted">{localUsage?.updatedAt ? t('usage.updatedAt', { time: formatDateTime(localUsage.updatedAt) }) : t('usage.card.notConnected')}</span><span className="muted">{localUsage?.requestWindowStartedAt ? t('usage.windowStartedAt', { time: formatDateTime(localUsage.requestWindowStartedAt) }) : t('usage.noData')}</span></div>
    <p className="field-hint">{t('usage.localIndependentHint')}</p>
  </Panel>
}
