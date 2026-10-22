import { useTranslation } from 'react-i18next'
import { Alert, Button, Space } from 'antd'
import { Activity, ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Cloud, Database, HardDrive, List, Package, PenLine, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react'
import type { CloudflareUsage, LocalUsage, PlatformSettings, UsageBreakdownEntry } from '../../api'
import { Panel } from '../../components/Panel'
import { translateError } from '../../errors'
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'
import { UsageResourceCard } from './UsageResourceCard'
import { UsageSection } from './UsageSection'

export function UsagePage({ settings, usage, localUsage, loading, refreshing, error, onRefresh, onOpenCloudflareSettings }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; loading: boolean; refreshing: boolean; error: string | null; onRefresh: () => void; onOpenCloudflareSettings: () => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const period = usage?.period
  const requests = usage?.requests
  const d1 = usage?.d1
  const kv = usage?.kv
  const durableObjects = usage?.durableObjects
  const quotas = settings?.quotas
  const cfQuotas = settings?.cloudflareQuotas
  const hasLocalUsage = localUsage !== null
  const connected = usage?.configured === true && typeof requests === 'number'
  // 上限未读取时百分比整体留空，避免把「还没拿到配置」画成 0%。
  const percent = (current: number | null | undefined, limit: number | undefined) => settings && current != null && limit != null ? usagePercent(current, limit) : undefined
  const limit = (value: number | undefined) => settings && value !== undefined ? formatNumber(value) : notRead
  const usageUpdatedAt = usage?.updatedAt
  const localUpdatedAt = localUsage?.updatedAt
  const requestWindowStartedAt = localUsage?.requestWindowStartedAt
  const configureAction = <Space size={4} wrap>
    <Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.configure')} <ArrowUpRight size={14} /></Button>
    <Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button>
  </Space>
  const accountMissing = usage?.configured === true && usage.accountIdConfigured === false
  const authorizationExpired = usage?.authorizationExpired === true

  return <div className="stack">
    {error
      ? <Alert type="error" showIcon message={t('usage.loadFailed')} description={<div className="alert-body"><span>{translateError(error)}</span><span>{t('usage.permissionHint')}</span></div>} action={<Space size={4} wrap><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.checkConfig')} <ArrowUpRight size={14} /></Button><Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button></Space>} />
      : authorizationExpired
        ? <Alert type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('usage.authorizationExpired')} description={<div className="alert-body"><span>{t('usage.authorizationExpiredHint')}</span></div>} action={<Space size={4} wrap><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.reauthorize')} <ArrowUpRight size={14} /></Button><Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button></Space>} />
        : accountMissing
          ? <Alert type="warning" showIcon icon={<ShieldAlert size={16} />} message={t('usage.accountMissing')} description={<div className="alert-body"><span>{t('usage.accountMissingHint')}</span><span>{t('usage.permissionHint')}</span></div>} action={<Space size={4} wrap><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.checkConfig')} <ArrowUpRight size={14} /></Button><Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button></Space>} />
          : <Alert type={connected ? 'success' : 'info'} showIcon icon={<Cloud size={16} />} message={loading ? t('usage.loadingOfficial') : connected ? t('usage.connected') : t('usage.notConnected')} description={connected && period ? t('usage.period', { start: formatDateTime(period.start), end: formatDateTime(period.end) }) : <div className="alert-body"><span>{t('usage.periodHint')}</span><span>{t('usage.localIndependentHint')}</span></div>} action={configureAction} />}
    <UsageSection title={t('usage.groups.platform')} hint={t('usage.groups.platformHint')}>
      <UsageResourceCard title={t('usage.card.platformRequests')} current={hasLocalUsage ? formatNumber(localUsage.requestCount) : '—'} limit={notRead} unit={hasLocalUsage ? t('usage.card.window24h') : t('usage.card.notConnected')} percent={null} icon={Activity} />
      <UsageResourceCard title={t('usage.card.connections')} current={hasLocalUsage ? formatNumber(localUsage.activeConnections) : '—'} limit={limit(quotas?.activeConnections)} unit={hasLocalUsage ? t('usage.card.connectionsUnit') : t('usage.card.notConnected')} percent={percent(localUsage?.activeConnections, quotas?.activeConnections)} icon={Activity} />
      <UsageResourceCard title={t('usage.card.r2')} current={hasLocalUsage ? formatBytes(localUsage.r2Bytes) ?? '—' : '—'} limit={settings ? formatBytes(quotas?.r2Bytes ?? 0) ?? notRead : notRead} unit={hasLocalUsage ? t('usage.card.objects', { count: localUsage.r2Objects }) : t('usage.card.notConnected')} percent={percent(localUsage?.r2Bytes, quotas?.r2Bytes)} icon={HardDrive} />
      <UsageResourceCard title={t('usage.card.r2Objects')} current={hasLocalUsage ? formatNumber(localUsage.r2Objects) : '—'} limit={limit(quotas?.r2Objects)} unit={hasLocalUsage ? t('usage.card.r2ObjectsUnit') : t('usage.card.notConnected')} percent={percent(localUsage?.r2Objects, quotas?.r2Objects)} icon={Package} />
    </UsageSection>
    <UsageSection title={t('usage.groups.cloudflare')} hint={t('usage.groups.cloudflareHint')}>
      <UsageResourceCard title={t('usage.card.workerRequests')} current={typeof requests === 'number' ? formatNumber(requests) : '—'} limit={limit(cfQuotas?.workerRequests)} unit={connected ? t('usage.card.officialPeriod') : t('usage.card.notConnected')} percent={percent(typeof requests === 'number' ? requests : null, cfQuotas?.workerRequests)} icon={Cloud} />
      <UsageResourceCard title={t('usage.card.d1RowsRead')} current={d1 ? formatNumber(d1.rowsRead) : '—'} limit={limit(cfQuotas?.d1RowsRead)} unit={d1 ? t('usage.card.readQueries', { count: formatNumber(d1.readQueries) }) : t('usage.card.notConnected')} percent={percent(d1?.rowsRead, cfQuotas?.d1RowsRead)} icon={ArrowDownToLine} />
      <UsageResourceCard title={t('usage.card.d1RowsWritten')} current={d1 ? formatNumber(d1.rowsWritten) : '—'} limit={limit(cfQuotas?.d1RowsWritten)} unit={d1 ? t('usage.card.writeQueries', { count: formatNumber(d1.writeQueries) }) : t('usage.card.notConnected')} percent={percent(d1?.rowsWritten, cfQuotas?.d1RowsWritten)} icon={ArrowUpFromLine} />
      <UsageResourceCard title={t('usage.card.kvRead')} current={kv ? formatNumber(kv.read) : '—'} limit={limit(cfQuotas?.kvRead)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.read, cfQuotas?.kvRead)} icon={Search} />
      <UsageResourceCard title={t('usage.card.kvWrite')} current={kv ? formatNumber(kv.write) : '—'} limit={limit(cfQuotas?.kvWrite)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.write, cfQuotas?.kvWrite)} icon={PenLine} />
      <UsageResourceCard title={t('usage.card.kvDelete')} current={kv ? formatNumber(kv.delete) : '—'} limit={limit(cfQuotas?.kvDelete)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.delete, cfQuotas?.kvDelete)} icon={Trash2} />
      <UsageResourceCard title={t('usage.card.kvList')} current={kv ? formatNumber(kv.list) : '—'} limit={limit(cfQuotas?.kvList)} unit={kv ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(kv?.list, cfQuotas?.kvList)} icon={List} />
      <UsageResourceCard title={t('usage.card.durableObjects')} current={durableObjects ? formatNumber(durableObjects.requests) : '—'} limit={limit(cfQuotas?.doRequests)} unit={durableObjects ? t('usage.card.daily') : t('usage.card.notConnected')} percent={percent(durableObjects?.requests, cfQuotas?.doRequests)} icon={Database} note={durableObjects ? t('usage.card.storage', { size: formatBytes(durableObjects.storedBytes) ?? '—' }) : undefined} />
    </UsageSection>
    <Panel title={t('usage.sourcesTitle')} subtitle={t('usage.sourcesSubtitle')}>
      <div className="source-row"><span className="source-name"><span className={`source-dot ${connected ? 'green' : 'pending'}`} />Cloudflare Analytics API</span><span className="muted">{connected ? `${usage?.cached ? t('usage.cached') : t('usage.latest')} · ${usageUpdatedAt ? formatDateTime(usageUpdatedAt) : t('usage.unknownTime')}` : t('usage.notConfigured')}</span><Space size={0}><Button type="link" size="small" icon={<RefreshCw size={13} />} onClick={onRefresh} loading={refreshing}>{t('usage.refresh')}</Button><Button type="link" size="small" onClick={onOpenCloudflareSettings}>{t('usage.configureSource')} <ArrowUpRight size={14} /></Button></Space></div>
      <div className="source-row"><span className="source-name"><span className={`source-dot ${hasLocalUsage ? 'green' : 'pending'}`} />{t('overview.note.localCount')}</span><span className="muted">{localUpdatedAt ? t('usage.updatedAt', { time: formatDateTime(localUpdatedAt) }) : t('usage.card.notConnected')}</span><span className="muted">{requestWindowStartedAt ? t('usage.windowStartedAt', { time: formatDateTime(requestWindowStartedAt) }) : t('usage.noData')}</span></div>
      <p className="field-hint">{t('usage.localIndependentHint')}</p>
    </Panel>
    <Panel className="breakdown-panel" title={t('usage.breakdown.title')} subtitle={t('usage.breakdown.subtitle')}>
      <div className="breakdown-grid"><BreakdownColumn title={t('usage.breakdown.users')} rows={localUsage?.breakdown.users ?? []} /><BreakdownColumn title={t('usage.breakdown.plugins')} rows={localUsage?.breakdown.plugins ?? []} /><BreakdownColumn title={t('usage.breakdown.domains')} rows={localUsage?.breakdown.domains ?? []} /></div>
    </Panel>
  </div>
}

function BreakdownColumn({ title, rows }: { title: string; rows: UsageBreakdownEntry[] }) {
  const { t } = useTranslation()
  return <div className="breakdown-column"><h3>{title}</h3>{rows.length === 0 ? <p className="breakdown-empty">{t('usage.breakdown.empty')}</p> : rows.map((row) => <div className="breakdown-row" key={row.id}><span title={row.label}>{row.label}</span><strong>{formatNumber(row.requests)}</strong></div>)}</div>
}
