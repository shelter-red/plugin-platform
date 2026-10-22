import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { ArrowUpRight } from 'lucide-react'
import type { CloudflareUsage, LocalUsage } from '../../api'
import { Panel } from '../../components/Panel'
import { formatDateTime } from '../../lib/format'

export function UsageSourcesPanel({ usage, localUsage, onOpenCloudflareSettings }: {
  usage: CloudflareUsage | null
  localUsage: LocalUsage | null
  onOpenCloudflareSettings: () => void
}) {
  const { t } = useTranslation()
  const connected = usage?.configured === true && typeof usage.requests === 'number'
  const hasLocalUsage = localUsage !== null
  return <Panel title={t('usage.sourcesTitle')} subtitle={t('usage.sourcesSubtitle')}>
    <div className="source-row"><span className="source-name"><span className={`source-dot ${connected ? 'green' : 'pending'}`} />Cloudflare Analytics API</span><span className="muted">{connected ? `${usage?.cached ? t('usage.cached') : t('usage.latest')} · ${usage.updatedAt ? formatDateTime(usage.updatedAt) : t('usage.unknownTime')}` : t('usage.notConfigured')}</span><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.configureSource')} <ArrowUpRight size={14} /></Button></div>
    <div className="source-row"><span className="source-name"><span className={`source-dot ${hasLocalUsage ? 'green' : 'pending'}`} />{t('overview.note.localCount')}</span><span className="muted">{localUsage?.updatedAt ? t('usage.updatedAt', { time: formatDateTime(localUsage.updatedAt) }) : t('usage.card.notConnected')}</span><span className="muted">{localUsage?.requestWindowStartedAt ? t('usage.windowStartedAt', { time: formatDateTime(localUsage.requestWindowStartedAt) }) : t('usage.noData')}</span></div>
    <p className="field-hint">{t('usage.localIndependentHint')}</p>
  </Panel>
}
