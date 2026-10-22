import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine, Cloud, Database, List, PenLine, Search, Trash2 } from 'lucide-react'
import type { CloudflareUsage, PlatformSettings } from '../../api'
import { formatBytes, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { UsageResourceCard } from './UsageResourceCard'
import { UsageSection } from './UsageSection'

/** Cloudflare 免费计划每日额度：Worker、D1、KV、Durable Objects 逐项显示用量与百分比。 */
export function CloudflareUsageSection({ settings, usage }: { settings: PlatformSettings | null; usage: CloudflareUsage | null }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const requests = usage?.requests
  const d1 = usage?.d1
  const kv = usage?.kv
  const durableObjects = usage?.durableObjects
  const cfQuotas = settings?.cloudflareQuotas
  const connected = usage?.configured === true && typeof requests === 'number'
  const percent = (current: number | null | undefined, limit: number | undefined) => settings && current != null && limit != null ? usagePercent(current, limit) : undefined
  const limit = (value: number | undefined) => settings && value !== undefined ? formatNumber(value) : notRead

  return <UsageSection title={t('usage.groups.cloudflare')} hint={t('usage.groups.cloudflareHint')}>
    <UsageResourceCard title={t('usage.card.workerRequests')} current={typeof requests === 'number' ? formatNumber(requests) : '—'} limit={limit(cfQuotas?.workerRequests)} unit={connected ? t('usage.card.officialPeriod') : t('usage.card.notConnected')} percent={percent(typeof requests === 'number' ? requests : null, cfQuotas?.workerRequests)} icon={Cloud} />
    <UsageResourceCard title={t('usage.card.d1RowsRead')} current={d1 ? formatNumber(d1.rowsRead) : '—'} limit={limit(cfQuotas?.d1RowsRead)} unit={d1 ? t('usage.card.readQueries', { count: formatNumber(d1.readQueries) }) : t('usage.card.notConnected')} percent={percent(d1?.rowsRead, cfQuotas?.d1RowsRead)} icon={ArrowDownToLine} />
    <UsageResourceCard title={t('usage.card.d1RowsWritten')} current={d1 ? formatNumber(d1.rowsWritten) : '—'} limit={limit(cfQuotas?.d1RowsWritten)} unit={d1 ? t('usage.card.writeQueries', { count: formatNumber(d1.writeQueries) }) : t('usage.card.notConnected')} percent={percent(d1?.rowsWritten, cfQuotas?.d1RowsWritten)} icon={ArrowUpFromLine} />
    <UsageResourceCard title={t('usage.card.kvRead')} current={kv ? formatNumber(kv.read) : '—'} limit={limit(cfQuotas?.kvRead)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.read, cfQuotas?.kvRead)} icon={Search} />
    <UsageResourceCard title={t('usage.card.kvWrite')} current={kv ? formatNumber(kv.write) : '—'} limit={limit(cfQuotas?.kvWrite)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.write, cfQuotas?.kvWrite)} icon={PenLine} />
    <UsageResourceCard title={t('usage.card.kvDelete')} current={kv ? formatNumber(kv.delete) : '—'} limit={limit(cfQuotas?.kvDelete)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.delete, cfQuotas?.kvDelete)} icon={Trash2} />
    <UsageResourceCard title={t('usage.card.kvList')} current={kv ? formatNumber(kv.list) : '—'} limit={limit(cfQuotas?.kvList)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.list, cfQuotas?.kvList)} icon={List} />
    <UsageResourceCard title={t('usage.card.durableObjects')} current={durableObjects ? formatNumber(durableObjects.requests) : '—'} limit={limit(cfQuotas?.doRequests)} unit={durableObjects ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(durableObjects?.requests, cfQuotas?.doRequests)} icon={Database} note={durableObjects ? t('usage.card.storage', { size: formatBytes(durableObjects.storedBytes) ?? '—' }) : undefined} />
  </UsageSection>
}
