import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { Activity, ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Cloud, HardDrive, Package, PenLine, Search } from 'lucide-react'
import type { CloudflareUsage, LocalUsage, PlatformSettings } from '../../api'
import type { Page } from '../../app/routes'
import { Panel } from '../../components/Panel'
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { ResourceRow } from './ResourceRow'

// 平台统计（本地计数，请求数不设上限）与 Cloudflare 免费额度分两组展示，
// 额度百分比只对官方免费额度计算，避免把平台计数误读成官方限制。
export function UsageResourcesPanel({ settings, usage, localUsage, onNavigate }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const quotas = settings?.quotas
  const cfQuotas = settings?.cloudflareQuotas
  const percent = (current: number | null | undefined, limit: number | undefined) => settings && current != null && limit != null ? usagePercent(current, limit) : undefined
  const limit = (value: number | undefined) => settings && value !== undefined ? formatNumber(value) : notRead
  return <Panel title={t('overview.resources.title')} subtitle={t('overview.resources.subtitle')} extra={<Button type="text" size="small" aria-label={t('overview.resources.detail')} title={t('overview.resources.detail')} onClick={() => onNavigate('usage')} icon={<ArrowUpRight size={15} />} />}>
    <div className="resource-group">
      <h3 className="resource-group-title">{t('usage.groups.platform')}</h3>
      <div className="resource-list">
        <ResourceRow label={t('overview.resources.requests')} value={localUsage ? formatNumber(localUsage.requestCount) : '—'} limit={notRead} percent={null} icon={Cloud} />
        <ResourceRow label={t('overview.resources.connections')} value={localUsage ? formatNumber(localUsage.activeConnections) : '—'} limit={limit(quotas?.activeConnections)} percent={percent(localUsage?.activeConnections, quotas?.activeConnections)} icon={Activity} />
        <ResourceRow label={t('overview.resources.r2')} value={localUsage ? formatBytes(localUsage.r2Bytes) ?? notRead : '—'} limit={settings ? formatBytes(quotas?.r2Bytes ?? 0) ?? notRead : notRead} percent={percent(localUsage?.r2Bytes, quotas?.r2Bytes)} icon={HardDrive} />
        <ResourceRow label={t('overview.resources.r2Objects')} value={localUsage ? formatNumber(localUsage.r2Objects) : '—'} limit={limit(quotas?.r2Objects)} percent={percent(localUsage?.r2Objects, quotas?.r2Objects)} icon={Package} />
      </div>
    </div>
    <div className="resource-group">
      <h3 className="resource-group-title">{t('usage.groups.cloudflare')}</h3>
      <div className="resource-list">
        <ResourceRow label={t('usage.card.workerRequests')} value={typeof usage?.requests === 'number' ? formatNumber(usage.requests) : '—'} limit={limit(cfQuotas?.workerRequests)} percent={percent(usage?.requests, cfQuotas?.workerRequests)} icon={Cloud} />
        <ResourceRow label={t('usage.card.d1RowsRead')} value={usage?.d1 ? formatNumber(usage.d1.rowsRead) : '—'} limit={limit(cfQuotas?.d1RowsRead)} percent={percent(usage?.d1?.rowsRead, cfQuotas?.d1RowsRead)} icon={ArrowDownToLine} />
        <ResourceRow label={t('usage.card.d1RowsWritten')} value={usage?.d1 ? formatNumber(usage.d1.rowsWritten) : '—'} limit={limit(cfQuotas?.d1RowsWritten)} percent={percent(usage?.d1?.rowsWritten, cfQuotas?.d1RowsWritten)} icon={ArrowUpFromLine} />
        <ResourceRow label={t('usage.card.kvRead')} value={usage?.kv ? formatNumber(usage.kv.read) : '—'} limit={limit(cfQuotas?.kvRead)} percent={percent(usage?.kv?.read, cfQuotas?.kvRead)} icon={Search} />
        <ResourceRow label={t('usage.card.kvWrite')} value={usage?.kv ? formatNumber(usage.kv.write) : '—'} limit={limit(cfQuotas?.kvWrite)} percent={percent(usage?.kv?.write, cfQuotas?.kvWrite)} icon={PenLine} />
        <ResourceRow label={t('usage.card.durableObjects')} value={usage?.durableObjects ? formatNumber(usage.durableObjects.requests) : '—'} limit={limit(cfQuotas?.doRequests)} percent={percent(usage?.durableObjects?.requests, cfQuotas?.doRequests)} icon={Activity} />
      </div>
    </div>
    <div className="resource-sources"><span>{usage?.updatedAt ? t('overview.resources.officialUpdated', { time: formatDateTime(usage.updatedAt) }) : t('overview.resources.officialMissing')}</span><span>{localUsage?.updatedAt ? t('overview.resources.localUpdated', { time: formatDateTime(localUsage.updatedAt) }) : t('overview.resources.localMissing')}</span></div>
    <Button type="link" size="small" onClick={() => onNavigate('usage')}>{t('overview.resources.allQuotas')} <ArrowUpRight size={14} /></Button>
  </Panel>
}
