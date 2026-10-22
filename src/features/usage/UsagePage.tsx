import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, ArrowUpRight, Cloud, Database, HardDrive } from 'lucide-react'
import type { CloudflareUsage, LocalUsage, PlatformSettings, UsageBreakdownEntry } from '../../api'
import type { Page } from '../../app/routes'
import { translateError } from '../../errors'
import { formatBytes, formatDateTime, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'

export function UsagePage({ settings, usage, localUsage, loading, error, onNavigate }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; loading: boolean; error: string | null; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const period = usage?.period
  const requests = usage?.requests
  const d1 = usage?.d1
  const kv = usage?.kv
  const durableObjects = usage?.durableObjects
  const quotas = settings?.quotas
  const hasLocalUsage = localUsage !== null
  const requestValue = typeof requests === 'number' ? formatNumber(requests) : '—'
  const localRequestValue = hasLocalUsage ? formatNumber(localUsage.requestCount) : '—'
  const requestLimit = quotas ? formatNumber(quotas.requests) : notRead
  const connectionLimit = quotas ? formatNumber(quotas.activeConnections) : notRead
  const r2Limit = quotas ? formatBytes(quotas.r2Bytes) ?? notRead : notRead
  const d1Limit = quotas ? formatNumber(quotas.d1Queries) : notRead
  const kvLimit = quotas ? formatNumber(quotas.kvOperations) : notRead
  const durableObjectLimit = quotas ? formatNumber(quotas.durableObjectRequests) : notRead
  const connected = usage?.configured === true && typeof requests === 'number'
  const d1Queries = d1 ? d1.readQueries + d1.writeQueries : null
  const kvOperations = kv ? kv.read + kv.write + kv.delete + kv.list : null
  const workerPercent = usagePercent(connected && typeof requests === 'number' ? requests : null, quotas?.requests)
  const localRequestPercent = usagePercent(localUsage?.requestCount, quotas?.requests)
  const r2Percent = usagePercent(localUsage?.r2Bytes, quotas?.r2Bytes)
  const connectionPercent = usagePercent(localUsage?.activeConnections, quotas?.activeConnections)
  const d1Percent = usagePercent(d1Queries, quotas?.d1Queries)
  const kvPercent = usagePercent(kvOperations, quotas?.kvOperations)
  const durableObjectPercent = usagePercent(durableObjects?.requests, quotas?.durableObjectRequests)
  const usageUpdatedAt = usage?.updatedAt
  const localUpdatedAt = localUsage?.updatedAt
  const requestWindowStartedAt = localUsage?.requestWindowStartedAt

  return <div className="stack">
    {error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('usage.loadFailed')}</strong><span>{translateError(error)}</span></div><button onClick={() => onNavigate('settings')}>{t('usage.checkConfig')} <ArrowUpRight size={14} /></button></div>}
    {!error && <div className="notice-bar compact"><div className="notice-icon"><Cloud size={16} /></div><div><strong>{loading ? t('usage.loadingOfficial') : connected ? t('usage.connected') : t('usage.notConnected')}</strong><span>{connected && period ? t('usage.period', { start: formatDateTime(period.start), end: formatDateTime(period.end) }) : t('usage.periodHint')}</span></div><button onClick={() => onNavigate('settings')}>{t('usage.configure')} <ArrowUpRight size={14} /></button></div>}
    <div className="usage-grid">
      <ResourceCard title={t('usage.card.workerRequests')} current={requestValue} limit={requestLimit} unit={connected ? t('usage.card.officialPeriod') : ''} percent={workerPercent} icon={Cloud} />
      <ResourceCard title={t('usage.card.platformRequests')} current={localRequestValue} limit={requestLimit} unit={hasLocalUsage ? t('usage.card.window24h') : t('usage.card.notConnected')} percent={localRequestPercent} icon={Activity} />
      <ResourceCard title={t('usage.card.r2')} current={hasLocalUsage ? formatBytes(localUsage.r2Bytes) ?? '—' : '—'} limit={r2Limit} unit={hasLocalUsage ? t('usage.card.objects', { count: localUsage.r2Objects }) : quotas ? t('usage.card.platformQuota') : ''} percent={r2Percent} icon={HardDrive} />
      <ResourceCard title={t('usage.card.connections')} current={hasLocalUsage ? formatNumber(localUsage.activeConnections) : '—'} limit={connectionLimit} unit={hasLocalUsage ? t('usage.card.connectionsUnit') : t('usage.card.notConnected')} percent={connectionPercent} icon={Activity} />
      <ResourceCard title={t('usage.card.d1')} current={d1Queries === null ? '—' : formatNumber(d1Queries)} limit={d1Limit} unit={d1 ? t('usage.card.rowsRead', { count: formatNumber(d1.rowsRead) }) : ''} percent={d1Percent} icon={Database} />
      <ResourceCard title={t('usage.card.kv')} current={kvOperations === null ? '—' : formatNumber(kvOperations)} limit={kvLimit} unit={kv ? t('usage.card.kvReads', { count: formatNumber(kv.read) }) : ''} percent={kvPercent} icon={HardDrive} />
      <ResourceCard title={t('usage.card.durableObjects')} current={durableObjects ? formatNumber(durableObjects.requests) : '—'} limit={durableObjectLimit} unit={durableObjects ? t('usage.card.storage', { size: formatBytes(durableObjects.storedBytes) ?? '—' }) : ''} percent={durableObjectPercent} icon={Activity} />
    </div>
    <div className="panel"><div className="panel-header"><div><h2>{t('usage.sourcesTitle')}</h2><p>{t('usage.sourcesSubtitle')}</p></div></div><div className="source-row"><span className="source-name"><span className={`source-dot ${connected ? 'green' : 'pending'}`} />Cloudflare Analytics API</span><span className="muted">{connected ? `${usage?.cached ? t('usage.cached') : t('usage.latest')} · ${usageUpdatedAt ? formatDateTime(usageUpdatedAt) : t('usage.unknownTime')}` : t('usage.notConfigured')}</span><button className="text-link" onClick={() => onNavigate('settings')}>{t('usage.configureSource')} <ArrowUpRight size={14} /></button></div><div className="source-row"><span className="source-name"><span className={`source-dot ${hasLocalUsage ? 'green' : 'pending'}`} />{t('overview.note.localCount')}</span><span className="muted">{localUpdatedAt ? t('usage.updatedAt', { time: formatDateTime(localUpdatedAt) }) : t('usage.card.notConnected')}</span><span className="muted">{requestWindowStartedAt ? t('usage.windowStartedAt', { time: formatDateTime(requestWindowStartedAt) }) : t('usage.noData')}</span></div></div>
    <div className="panel breakdown-panel"><div className="panel-header"><div><h2>{t('usage.breakdown.title')}</h2><p>{t('usage.breakdown.subtitle')}</p></div></div><div className="breakdown-grid"><BreakdownColumn title={t('usage.breakdown.users')} rows={localUsage?.breakdown.users ?? []} /><BreakdownColumn title={t('usage.breakdown.plugins')} rows={localUsage?.breakdown.plugins ?? []} /><BreakdownColumn title={t('usage.breakdown.domains')} rows={localUsage?.breakdown.domains ?? []} /></div></div>
  </div>
}

function BreakdownColumn({ title, rows }: { title: string; rows: UsageBreakdownEntry[] }) {
  const { t } = useTranslation()
  return <div className="breakdown-column"><h3>{title}</h3>{rows.length === 0 ? <p className="breakdown-empty">{t('usage.breakdown.empty')}</p> : rows.map((row) => <div className="breakdown-row" key={row.id}><span title={row.label}>{row.label}</span><strong>{formatNumber(row.requests)}</strong></div>)}</div>
}

function ResourceCard({ title, current, limit, unit, percent = 0, icon: Icon }: { title: string; current: string; limit: string; unit: string; percent?: number; icon: typeof Cloud }) {
  const { t } = useTranslation()
  return <div className="resource-card"><div className="resource-card-head"><div className="resource-card-icon"><Icon size={17} /></div><span>{title}</span></div><strong>{current}</strong><div className="resource-card-limit">{t('common.upperLimit', { limit })} <span>{unit}</span></div><div className="progress"><span style={{ width: `${percent}%` }} /></div></div>
}
