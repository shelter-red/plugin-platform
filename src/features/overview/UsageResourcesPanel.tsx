import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { Activity, ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Cloud, Database, HardDrive, List, Package, PenLine, Search, Trash2 } from 'lucide-react'
import type { CloudflareUsage, CloudflareUsageLimits, LocalUsage, PlatformSettings } from '../../api'
import type { Page } from '../../app/routes'
import { Panel } from '../../components/Panel'
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { ResourceRow } from './ResourceRow'

type LimitKey = keyof CloudflareUsageLimits

// 平台统计（本地计数，请求数不设上限）与 Cloudflare 免费额度分两组展示，
// 额度百分比只对 subscriptions 确认过的官方 Free limits 计算。
export function UsageResourcesPanel({ settings, usage, localUsage, onNavigate }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const quotas = settings?.quotas
  const limits = usage?.limits
  const limitsConfirmed = usage?.limitSource === 'cloudflare_subscriptions_free_baseline' && limits != null
  const percent = (current: number | null | undefined, limit: number | undefined) => current != null && limit != null ? usagePercent(current, limit) : undefined
  const limit = (value: number | undefined) => value !== undefined ? formatNumber(value) : notRead
  const cloudflareLimit = (key: LimitKey) => limitsConfirmed ? limit(limits[key]) : notRead
  const cloudflareFormattedLimit = (key: LimitKey) => limitsConfirmed
    ? key === 'd1StorageBytes' ? formatBytes(limits[key]) ?? notRead : limit(limits[key])
    : notRead
  const cloudflarePercent = (current: number | null | undefined, key: LimitKey) => limitsConfirmed ? percent(current, limits[key]) : undefined

  return <Panel title={t('overview.resources.title')} subtitle={t('overview.resources.subtitle')} extra={<Button type="text" size="small" aria-label={t('overview.resources.detail')} title={t('overview.resources.detail')} onClick={() => onNavigate('usage')} icon={<ArrowUpRight size={15} />} />}>
    <div className="resource-group">
      <h3 className="resource-group-title">{t('usage.groups.platform')}</h3>
      <div className="resource-list">
        <ResourceRow label={t('overview.resources.requests')} value={localUsage ? formatNumber(localUsage.requestCount) : '—'} limit={t('usage.card.unlimited')} percent={null} icon={Cloud} />
        <ResourceRow label={t('overview.resources.connections')} value={localUsage ? formatNumber(localUsage.activeConnections) : '—'} limit={limit(quotas?.activeConnections)} percent={percent(localUsage?.activeConnections, quotas?.activeConnections)} icon={Activity} />
        <ResourceRow label={t('overview.resources.r2')} value={localUsage ? formatBytes(localUsage.r2Bytes) ?? notRead : '—'} limit={settings ? formatBytes(quotas?.r2Bytes ?? 0) ?? notRead : notRead} percent={percent(localUsage?.r2Bytes, quotas?.r2Bytes)} icon={HardDrive} />
        <ResourceRow label={t('overview.resources.r2Objects')} value={localUsage ? formatNumber(localUsage.r2Objects) : '—'} limit={limit(quotas?.r2Objects)} percent={percent(localUsage?.r2Objects, quotas?.r2Objects)} icon={Package} />
      </div>
    </div>
    <div className="resource-group">
      <h3 className="resource-group-title">{t('usage.groups.cloudflare')}</h3>
      <div className="resource-list">
        <ResourceRow label={t('usage.card.workerRequests')} value={typeof usage?.requests === 'number' ? formatNumber(usage.requests) : '—'} limit={cloudflareLimit('workerRequests')} percent={cloudflarePercent(usage?.requests, 'workerRequests')} icon={Cloud} />
        <ResourceRow label={t('usage.card.d1RowsRead')} value={usage?.d1 ? formatNumber(usage.d1.rowsRead) : '—'} limit={cloudflareLimit('d1RowsRead')} percent={cloudflarePercent(usage?.d1?.rowsRead, 'd1RowsRead')} icon={ArrowDownToLine} />
        <ResourceRow label={t('usage.card.d1RowsWritten')} value={usage?.d1 ? formatNumber(usage.d1.rowsWritten) : '—'} limit={cloudflareLimit('d1RowsWritten')} percent={cloudflarePercent(usage?.d1?.rowsWritten, 'd1RowsWritten')} icon={ArrowUpFromLine} />
        <ResourceRow label={t('usage.card.d1Storage')} value={usage?.d1 ? formatBytes(usage.d1.storageBytes) ?? '—' : '—'} limit={cloudflareFormattedLimit('d1StorageBytes')} percent={cloudflarePercent(usage?.d1?.storageBytes, 'd1StorageBytes')} icon={Database} />
        <ResourceRow label={t('usage.card.kvRead')} value={usage?.kv ? formatNumber(usage.kv.read) : '—'} limit={cloudflareLimit('kvRead')} percent={cloudflarePercent(usage?.kv?.read, 'kvRead')} icon={Search} />
        <ResourceRow label={t('usage.card.kvWrite')} value={usage?.kv ? formatNumber(usage.kv.write) : '—'} limit={cloudflareLimit('kvWrite')} percent={cloudflarePercent(usage?.kv?.write, 'kvWrite')} icon={PenLine} />
        <ResourceRow label={t('usage.card.kvDelete')} value={usage?.kv ? formatNumber(usage.kv.delete) : '—'} limit={cloudflareLimit('kvDelete')} percent={cloudflarePercent(usage?.kv?.delete, 'kvDelete')} icon={Trash2} />
        <ResourceRow label={t('usage.card.kvList')} value={usage?.kv ? formatNumber(usage.kv.list) : '—'} limit={cloudflareLimit('kvList')} percent={cloudflarePercent(usage?.kv?.list, 'kvList')} icon={List} />
        <ResourceRow label={t('usage.card.durableObjects')} value={usage?.durableObjects ? formatNumber(usage.durableObjects.requests) : '—'} limit={cloudflareLimit('doRequests')} percent={cloudflarePercent(usage?.durableObjects?.requests, 'doRequests')} icon={Activity} />
      </div>
    </div>
    <div className="resource-sources"><span>{usage?.updatedAt ? t('overview.resources.officialUpdated', { time: formatDateTime(usage.updatedAt) }) : t('overview.resources.officialMissing')}</span><span>{localUsage?.updatedAt ? t('overview.resources.localUpdated', { time: formatDateTime(localUsage.updatedAt) }) : t('overview.resources.localMissing')}</span></div>
  </Panel>
}
