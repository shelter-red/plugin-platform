import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { Activity, ArrowUpRight, Cloud, Database, HardDrive } from 'lucide-react'
import type { CloudflareUsage, LocalUsage, PlatformSettings } from '../../api'
import type { Page } from '../../app/routes'
import { Panel } from '../../components/Panel'
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { ResourceRow } from './ResourceRow'

// 本地计数（请求数、R2 字节）来自自建统计，D1/KV/DO 只能来自 Cloudflare 官方用量，
// 两条数据源各自缺失时显示「—」，上限沿用平台设置的配额。
export function UsageResourcesPanel({ settings, usage, localUsage, onNavigate }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const requestCount = localUsage ? formatNumber(localUsage.requestCount) : '—'
  const requestLimit = settings ? formatNumber(settings.quotas.requests) : notRead
  const r2Value = localUsage ? formatBytes(localUsage.r2Bytes) ?? notRead : '—'
  const r2Limit = settings ? formatBytes(settings.quotas.r2Bytes) ?? notRead : notRead
  const d1Queries = usage?.d1 ? usage.d1.readQueries + usage.d1.writeQueries : null
  const kvOperations = usage?.kv ? usage.kv.read + usage.kv.write + usage.kv.delete + usage.kv.list : null
  const durableObjectRequests = usage?.durableObjects?.requests ?? null
  const d1Limit = settings ? formatNumber(settings.quotas.d1Queries) : notRead
  const kvLimit = settings ? formatNumber(settings.quotas.kvOperations) : notRead
  const durableObjectLimit = settings ? formatNumber(settings.quotas.durableObjectRequests) : notRead
  return <Panel title={t('overview.resources.title')} subtitle={t('overview.resources.subtitle')} extra={<Button type="text" size="small" aria-label={t('overview.resources.detail')} title={t('overview.resources.detail')} onClick={() => onNavigate('usage')} icon={<ArrowUpRight size={15} />} />}>
    <div className="resource-list">
      <ResourceRow label={t('overview.resources.requests')} value={requestCount} limit={requestLimit} percent={usagePercent(localUsage?.requestCount, settings?.quotas.requests)} icon={Cloud} />
      <ResourceRow label={t('overview.resources.r2')} value={r2Value} limit={r2Limit} percent={usagePercent(localUsage?.r2Bytes, settings?.quotas.r2Bytes)} icon={HardDrive} />
      <ResourceRow label={t('overview.resources.d1')} value={d1Queries === null ? '—' : formatNumber(d1Queries)} limit={d1Limit} percent={usagePercent(d1Queries, settings?.quotas.d1Queries)} icon={Database} />
      <ResourceRow label={t('overview.resources.kv')} value={kvOperations === null ? '—' : formatNumber(kvOperations)} limit={kvLimit} percent={usagePercent(kvOperations, settings?.quotas.kvOperations)} icon={HardDrive} />
      <ResourceRow label={t('overview.resources.durableObjects')} value={durableObjectRequests === null ? '—' : formatNumber(durableObjectRequests)} limit={durableObjectLimit} percent={usagePercent(durableObjectRequests, settings?.quotas.durableObjectRequests)} icon={Activity} />
    </div>
    <div className="resource-sources"><span>{usage?.updatedAt ? t('overview.resources.officialUpdated', { time: formatDateTime(usage.updatedAt) }) : t('overview.resources.officialMissing')}</span><span>{localUsage?.updatedAt ? t('overview.resources.localUpdated', { time: formatDateTime(localUsage.updatedAt) }) : t('overview.resources.localMissing')}</span></div>
    <Button type="link" size="small" onClick={() => onNavigate('usage')}>{t('overview.resources.allQuotas')} <ArrowUpRight size={14} /></Button>
  </Panel>
}
