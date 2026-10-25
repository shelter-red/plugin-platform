import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine, Cloud, Database, List, PenLine, Search, Trash2 } from 'lucide-react'
import type { CloudflareUsage, CloudflareUsageLimits } from '../../api'
import { formatBytes, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { UsageResourceCard } from './UsageResourceCard'
import { UsageSection } from './UsageSection'

type LimitKey = keyof CloudflareUsageLimits

/** Cloudflare 免费计划每日额度：只使用 Worker 从 subscriptions 读取并确认的 limits。 */
export function CloudflareUsageSection({ usage }: { usage: CloudflareUsage | null }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const requests = usage?.requests
  const d1 = usage?.d1
  const kv = usage?.kv
  const durableObjects = usage?.durableObjects
  const limits = usage?.limits
  const limitsConfirmed = usage?.limitSource === 'cloudflare_subscriptions_free_baseline' && limits != null
  const connected = usage?.configured === true
  const limit = (key: LimitKey) => limitsConfirmed ? formatNumber(limits[key]) : notRead
  const formattedLimit = (key: LimitKey) => limitsConfirmed
    ? key === 'd1StorageBytes' ? formatBytes(limits[key]) ?? notRead : formatNumber(limits[key])
    : notRead
  const percent = (current: number | null | undefined, key: LimitKey) => limitsConfirmed && current != null ? usagePercent(current, limits[key]) : undefined
  const hint = usage?.plan?.confirmed && usage.plan.free
    ? t('usage.groups.cloudflareFreeHint')
    : connected ? t('usage.groups.cloudflareUnconfirmedHint') : t('usage.groups.cloudflareHint')

  return <UsageSection title={t('usage.groups.cloudflare')} hint={hint}>
    <UsageResourceCard title={t('usage.card.workerRequests')} current={typeof requests === 'number' ? formatNumber(requests) : '—'} limit={limit('workerRequests')} unit={connected ? t('usage.card.officialPeriod') : t('usage.card.notConnected')} percent={percent(requests, 'workerRequests')} icon={Cloud} />
    <UsageResourceCard title={t('usage.card.d1RowsRead')} current={d1 ? formatNumber(d1.rowsRead) : '—'} limit={limit('d1RowsRead')} unit={d1 ? `${t('usage.card.readQueries', { count: formatNumber(d1.readQueries) })} · ${t('usage.card.d1UtcDay', { date: usage?.d1Period?.date })}` : t('usage.card.notConnected')} percent={percent(d1?.rowsRead, 'd1RowsRead')} icon={ArrowDownToLine} />
    <UsageResourceCard title={t('usage.card.d1RowsWritten')} current={d1 ? formatNumber(d1.rowsWritten) : '—'} limit={limit('d1RowsWritten')} unit={d1 ? `${t('usage.card.writeQueries', { count: formatNumber(d1.writeQueries) })} · ${t('usage.card.d1UtcDay', { date: usage?.d1Period?.date })}` : t('usage.card.notConnected')} percent={percent(d1?.rowsWritten, 'd1RowsWritten')} icon={ArrowUpFromLine} />
    <UsageResourceCard title={t('usage.card.d1Storage')} current={d1 ? formatBytes(d1.storageBytes) ?? '—' : '—'} limit={formattedLimit('d1StorageBytes')} unit={d1 ? t('usage.card.snapshot') : t('usage.card.notConnected')} percent={percent(d1?.storageBytes, 'd1StorageBytes')} icon={Database} />
    <UsageResourceCard title={t('usage.card.kvRead')} current={kv ? formatNumber(kv.read) : '—'} limit={limit('kvRead')} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.read, 'kvRead')} icon={Search} />
    <UsageResourceCard title={t('usage.card.kvWrite')} current={kv ? formatNumber(kv.write) : '—'} limit={limit('kvWrite')} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.write, 'kvWrite')} icon={PenLine} />
    <UsageResourceCard title={t('usage.card.kvDelete')} current={kv ? formatNumber(kv.delete) : '—'} limit={limit('kvDelete')} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.delete, 'kvDelete')} icon={Trash2} />
    <UsageResourceCard title={t('usage.card.kvList')} current={kv ? formatNumber(kv.list) : '—'} limit={limit('kvList')} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.list, 'kvList')} icon={List} />
    <UsageResourceCard title={t('usage.card.durableObjects')} current={durableObjects ? formatNumber(durableObjects.requests) : '—'} limit={limit('doRequests')} unit={durableObjects ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(durableObjects?.requests, 'doRequests')} icon={Database} note={durableObjects ? t('usage.card.storage', { size: formatBytes(durableObjects.storedBytes) ?? '—' }) : undefined} />
  </UsageSection>
}
