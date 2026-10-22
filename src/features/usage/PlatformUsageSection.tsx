import { useTranslation } from 'react-i18next'
import { Activity, HardDrive, Package } from 'lucide-react'
import type { LocalUsage, PlatformSettings } from '../../api'
import { formatBytes, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { UsageResourceCard } from './UsageResourceCard'
import { UsageSection } from './UsageSection'

/** 平台自身统计：请求数只计数不设上限，其余资源按平台可拒绝的阈值显示百分比。 */
export function PlatformUsageSection({ settings, localUsage }: { settings: PlatformSettings | null; localUsage: LocalUsage | null }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const quotas = settings?.quotas
  const hasLocalUsage = localUsage !== null
  const percent = (current: number | null | undefined, limit: number | undefined) => settings && current != null && limit != null ? usagePercent(current, limit) : undefined
  const limit = (value: number | undefined) => settings && value !== undefined ? formatNumber(value) : notRead

  return <UsageSection title={t('usage.groups.platform')} hint={t('usage.groups.platformHint')}>
    <UsageResourceCard title={t('usage.card.platformRequests')} current={hasLocalUsage ? formatNumber(localUsage.requestCount) : '—'} limit={t('usage.card.unlimited')} unit={hasLocalUsage ? t('usage.card.window24h') : t('usage.card.notConnected')} percent={null} icon={Activity} />
    <UsageResourceCard title={t('usage.card.connections')} current={hasLocalUsage ? formatNumber(localUsage.activeConnections) : '—'} limit={limit(quotas?.activeConnections)} unit={hasLocalUsage ? t('usage.card.connectionsUnit') : t('usage.card.notConnected')} percent={percent(localUsage?.activeConnections, quotas?.activeConnections)} icon={Activity} />
    <UsageResourceCard title={t('usage.card.r2')} current={hasLocalUsage ? formatBytes(localUsage.r2Bytes) ?? '—' : '—'} limit={settings ? formatBytes(quotas?.r2Bytes ?? 0) ?? notRead : notRead} unit={hasLocalUsage ? t('usage.card.objects', { count: localUsage.r2Objects }) : t('usage.card.notConnected')} percent={percent(localUsage?.r2Bytes, quotas?.r2Bytes)} icon={HardDrive} />
    <UsageResourceCard title={t('usage.card.r2Objects')} current={hasLocalUsage ? formatNumber(localUsage.r2Objects) : '—'} limit={limit(quotas?.r2Objects)} unit={hasLocalUsage ? t('usage.card.r2ObjectsUnit') : t('usage.card.notConnected')} percent={percent(localUsage?.r2Objects, quotas?.r2Objects)} icon={Package} />
  </UsageSection>
}
