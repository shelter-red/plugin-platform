import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, ArrowUpRight, Box, Check, Cloud, Database, Globe2, HardDrive, RefreshCw, Server, ShieldCheck, Zap } from 'lucide-react'
import type { ApiAccessLog, ApiAudit, ApiOverview, ApiServer, CloudflareUsage, LocalUsage, PlatformSettings, UsageSnapshot } from '../../api'
import type { Page } from '../../app/routes'
import { IconButton } from '../../components/IconButton'
import { StatusBadge } from '../../components/StatusBadge'
import { translateError } from '../../errors'
import { auditActionLabel, auditDetail } from '../../lib/audit'
import { currentLocale, formatBytes, formatDateTime, formatNumber } from '../../lib/format'
import { usagePercent } from '../../lib/usage'

export function OverviewPage({ overview, usage, localUsage, settings, audits, accessLogs, accessLogsLoading, accessLogsError, servers, range, setRange, onNavigate }: { overview: ApiOverview | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; settings: PlatformSettings | null; audits: ApiAudit[]; accessLogs: ApiAccessLog[] | null; accessLogsLoading: boolean; accessLogsError: string | null; servers: ApiServer[]; range: '24h' | '7d' | '30d'; setRange: (value: '24h' | '7d' | '30d') => void; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const onlineServers = overview ? String(overview.onlineServers) : '—'
  const enabledPlugins = overview ? String(overview.enabledPlugins) : '—'
  const domains = overview ? String(overview.domains) : '—'
  const activeConnections = localUsage ? formatNumber(localUsage.activeConnections) : '—'
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
  const requestPercent = usagePercent(localUsage?.requestCount, settings?.quotas.requests)
  const r2Percent = usagePercent(localUsage?.r2Bytes, settings?.quotas.r2Bytes)
  const d1Percent = usagePercent(d1Queries, settings?.quotas.d1Queries)
  const kvPercent = usagePercent(kvOperations, settings?.quotas.kvOperations)
  const durableObjectPercent = usagePercent(durableObjectRequests, settings?.quotas.durableObjectRequests)
  const apiNote = overview ? t('overview.note.fromApi') : t('common.noData')
  const localNote = localUsage ? t('overview.note.localCount') : t('overview.note.noLocalCount')
  const recentErrors = (accessLogs ?? []).filter((log) => log.status >= 500).slice(0, 3)
  const connectionIssues = servers.filter((server) => server.status !== 'online').slice(0, 3)
  return <>
    <div className="notice-bar"><div className="notice-icon"><ShieldCheck size={16} /></div><div><strong>{overview ? t('overview.noticeConnected') : t('overview.noticeWaiting')}</strong><span>{overview ? t('overview.noticeConnectedBody') : t('overview.noticeWaitingBody')}</span></div><StatusBadge tone={settings ? settings.maintenance ? 'warning' : 'success' : 'neutral'}>{settings ? settings.maintenance ? t('overview.maintenance.on') : t('overview.maintenance.off') : t('overview.maintenance.unknown')}</StatusBadge><button onClick={() => onNavigate('settings')}>{t('overview.configure')} <ArrowUpRight size={14} /></button></div>
    <section className="metric-grid">
      <Metric label={t('overview.metric.onlineServers')} value={onlineServers} suffix="" note={apiNote} icon={Server} tone="green" onClick={() => onNavigate('servers')} />
      <Metric label={t('overview.metric.enabledPlugins')} value={enabledPlugins} suffix="" note={apiNote} icon={Box} tone="blue" onClick={() => onNavigate('plugins')} />
      <Metric label={t('overview.metric.domains')} value={domains} suffix="" note={apiNote} icon={Globe2} tone="purple" onClick={() => onNavigate('domains')} />
      <Metric label={t('overview.metric.connections')} value={activeConnections} suffix="" note={localNote} icon={Zap} tone="amber" onClick={() => onNavigate('usage')} />
    </section>
    <section className="content-grid two-thirds">
      <div className="panel chart-panel"><div className="panel-header"><div><h2>{t('overview.trend.title')}</h2><p>{t('overview.trend.subtitle')}</p></div><div className="segmented">{(['24h', '7d', '30d'] as const).map((item) => <button className={range === item ? 'selected' : ''} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div><RequestTrend range={range} snapshots={localUsage?.snapshots ?? []} /></div>
      <div className="panel"><div className="panel-header"><div><h2>{t('overview.resources.title')}</h2><p>{t('overview.resources.subtitle')}</p></div><IconButton label={t('overview.resources.detail')} onClick={() => onNavigate('usage')}><ArrowUpRight size={15} /></IconButton></div><div className="resource-list"><Resource label={t('overview.resources.requests')} value={requestCount} limit={requestLimit} percent={requestPercent} icon={Cloud} /><Resource label={t('overview.resources.r2')} value={r2Value} limit={r2Limit} percent={r2Percent} icon={HardDrive} /><Resource label={t('overview.resources.d1')} value={d1Queries === null ? '—' : formatNumber(d1Queries)} limit={d1Limit} percent={d1Percent} icon={Database} /><Resource label={t('overview.resources.kv')} value={kvOperations === null ? '—' : formatNumber(kvOperations)} limit={kvLimit} percent={kvPercent} icon={HardDrive} /><Resource label={t('overview.resources.durableObjects')} value={durableObjectRequests === null ? '—' : formatNumber(durableObjectRequests)} limit={durableObjectLimit} percent={durableObjectPercent} icon={Activity} /></div><div className="resource-sources"><span>{usage?.updatedAt ? t('overview.resources.officialUpdated', { time: formatDateTime(usage.updatedAt) }) : t('overview.resources.officialMissing')}</span><span>{localUsage?.updatedAt ? t('overview.resources.localUpdated', { time: formatDateTime(localUsage.updatedAt) }) : t('overview.resources.localMissing')}</span></div><button className="text-link" onClick={() => onNavigate('usage')}>{t('overview.resources.allQuotas')} <ArrowUpRight size={14} /></button></div>
    </section>
    <section className="content-grid two-thirds bottom-grid"><div className="panel"><div className="panel-header"><div><h2>{t('overview.activity.title')}</h2><p>{t('overview.activity.subtitle')}</p></div><button className="text-link" onClick={() => onNavigate('audit')}>{t('overview.activity.viewAll')} <ArrowUpRight size={14} /></button></div>{audits.length > 0 ? <div className="activity-list">{audits.slice(0, 3).map((item) => <div className="activity-item" key={item.id}><div className="activity-mark success"><Check size={13} /></div><div className="activity-copy"><strong>{auditActionLabel(item.action)}</strong><span>{auditDetail(item)}</span></div><time>{formatDateTime(item.created_at)}</time></div>)}</div> : <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>{t('overview.activity.emptyTitle')}</h3><p>{t('overview.activity.emptyBody')}</p></div>}</div><div className="panel quick-panel"><div className="panel-header"><div><h2>{t('overview.quick.title')}</h2><p>{t('overview.quick.subtitle')}</p></div></div><QuickStep number="01" title={t('overview.quick.bindTitle')} detail={t('overview.quick.bindDetail')} onClick={() => onNavigate('servers')} /><QuickStep number="02" title={t('overview.quick.loadTitle')} detail={t('overview.quick.loadDetail')} onClick={() => onNavigate('plugins')} /><QuickStep number="03" title={t('overview.quick.domainTitle')} detail={t('overview.quick.domainDetail')} onClick={() => onNavigate('domains')} /></div></section>
    <section className="panel bottom-grid"><div className="panel-header"><div><h2>{t('overview.errors.title')}</h2><p>{t('overview.errors.subtitle')}</p></div><button className="text-link" onClick={() => onNavigate('logs')}>{t('overview.errors.viewAll')} <ArrowUpRight size={14} /></button></div>{connectionIssues.length > 0 || (!accessLogsError && !accessLogsLoading && recentErrors.length > 0) ? <div className="activity-list">{connectionIssues.map((server) => <div className="activity-item" key={server.id}><div className="activity-mark danger"><Server size={13} /></div><div className="activity-copy"><strong>{server.name}</strong><span>{server.last_seen_at ? t('servers.lastSeen', { time: formatDateTime(server.last_seen_at) }) : t('servers.neverConnected')}</span></div><StatusBadge tone="danger">{t(`status.${server.status}`, { defaultValue: server.status })}</StatusBadge></div>)}{recentErrors.map((log) => <div className="activity-item" key={log.id}><div className="activity-mark danger"><AlertCircle size={13} /></div><div className="activity-copy"><strong>{log.hostname}{log.path}</strong><span>{log.method} · {log.error ?? t('overview.errors.unknownError')}</span></div><StatusBadge tone="danger">{log.status}</StatusBadge><time>{formatDateTime(log.created_at)}</time></div>)}</div> : accessLogsError ? <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('overview.errors.loadFailed')}</strong><span>{translateError(accessLogsError)}</span></div></div> : accessLogsLoading ? <div className="empty-panel"><div className="empty-illustration"><RefreshCw size={20} /></div><h3>{t('overview.errors.loadingTitle')}</h3><p>{t('overview.errors.loadingBody')}</p></div> : <div className="empty-panel"><div className="empty-illustration"><ShieldCheck size={20} /></div><h3>{t('overview.errors.emptyTitle')}</h3><p>{t('overview.errors.emptyBody')}</p></div>}</section>
  </>
}

function Metric({ label, value, suffix, note, icon: Icon, tone, onClick }: { label: string; value: string; suffix: string; note: string; icon: typeof Server; tone: string; onClick: () => void }) { return <button className="metric-card" onClick={onClick}><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div className="metric-label">{label}<ArrowUpRight size={13} /></div><div className="metric-number">{value}<small>{suffix}</small></div><div className="metric-note"><span className="status-dot green" />{note}</div></button> }

function RequestTrend({ range, snapshots }: { range: '24h' | '7d' | '30d'; snapshots: UsageSnapshot[] }) {
  const { t } = useTranslation()
  const sampled = sampleUsageSnapshots(snapshots)
  if (sampled.length === 0) return <div className="empty-chart chart-empty-state"><Activity size={20} /><strong>{t('overview.trend.emptyTitle')}</strong><span>{t('overview.trend.emptyBody')}</span></div>
  const maximum = Math.max(...sampled.map((snapshot) => snapshot.request_count), 1)
  const first = sampled[0]
  const last = sampled[sampled.length - 1]
  return <div className="empty-chart" role="img" aria-label={t('overview.trend.aria', { range })}><div className="chart-grid-lines"><span /><span /><span /><span /></div><div className="chart-bars">{sampled.map((snapshot) => <div className="bar-wrap" key={snapshot.captured_at}><div className="chart-bar accent" style={{ height: `${Math.max(6, snapshot.request_count / maximum * 100)}%` }} title={t('overview.trend.tooltip', { time: formatTrendTime(snapshot.captured_at), count: formatNumber(snapshot.request_count) })} /></div>)}</div><div className="chart-axis"><span>{formatTrendTime(first.captured_at)}</span><span>{formatTrendTime(last.captured_at)}</span></div><div className="chart-footnote"><span><span className="legend-dot" />{t('overview.trend.series')}</span><span>{t('overview.trend.summary', { range, count: formatNumber(last.request_count) })}</span></div></div>
}

function sampleUsageSnapshots(snapshots: UsageSnapshot[], limit = 24): UsageSnapshot[] {
  if (snapshots.length <= limit) return snapshots
  const bucketSize = Math.ceil(snapshots.length / limit)
  return Array.from({ length: Math.ceil(snapshots.length / bucketSize) }, (_, index) => snapshots[Math.min((index + 1) * bucketSize - 1, snapshots.length - 1)])
}

function formatTrendTime(value: string): string {
  return new Date(value).toLocaleString(currentLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Resource({ label, value, limit, percent, icon: Icon }: { label: string; value: string; limit: string; percent: number; icon: typeof Cloud }) {
  const { t } = useTranslation()
  return <div className="resource"><div className="resource-top"><div className="resource-label"><Icon size={15} />{label}</div><strong>{value}</strong></div><div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div><div className="resource-bottom"><span>{t('common.currentUsage')}</span><span>{limit}</span></div></div>
}

function QuickStep({ number, title, detail, done, onClick }: { number: string; title: string; detail: string; done?: boolean; onClick: () => void }) { return <button className="quick-step" onClick={onClick}><span className={`step-number ${done ? 'done' : ''}`}>{done ? <Check size={13} /> : number}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></button> }
