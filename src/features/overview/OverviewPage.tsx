import { useTranslation } from 'react-i18next'
import { Alert, Button } from 'antd'
import { ArrowUpRight, Box, Globe2, Server, ShieldCheck, Zap } from 'lucide-react'
import type { ApiAccessLog, ApiAudit, ApiOverview, ApiServer, CloudflareUsage, LocalUsage, PlatformSettings } from '../../api'
import type { Page } from '../../app/routes'
import { StatusBadge } from '../../components/StatusBadge'
import { formatNumber } from '../../lib/format'
import { MetricCard } from './MetricCard'
import { OverviewActivityPanel } from './OverviewActivityPanel'
import { OverviewIssuesPanel } from './OverviewIssuesPanel'
import { QuickStartPanel } from './QuickStartPanel'
import { RequestTrendPanel } from './RequestTrend'
import { UsageResourcesPanel } from './UsageResourcesPanel'

export function OverviewPage({ overview, usage, localUsage, settings, audits, accessLogs, accessLogsLoading, accessLogsError, servers, range, setRange, onNavigate }: { overview: ApiOverview | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; settings: PlatformSettings | null; audits: ApiAudit[]; accessLogs: ApiAccessLog[] | null; accessLogsLoading: boolean; accessLogsError: string | null; servers: ApiServer[]; range: '24h' | '7d' | '30d'; setRange: (value: '24h' | '7d' | '30d') => void; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  // 服务器/插件/域名来自 `/api/overview`，连接数来自本地统计：两处口径不同，因此分开标注来源。
  const apiNote = overview ? t('overview.note.fromApi') : t('common.noData')
  const localNote = localUsage ? t('overview.note.localCount') : t('overview.note.noLocalCount')
  const maintenance = settings ? settings.maintenance ? 'warning' as const : 'success' as const : 'neutral' as const
  return <>
    <Alert
      className="notice-bar"
      type={settings?.maintenance ? 'warning' : 'success'}
      showIcon
      icon={<ShieldCheck size={16} />}
      message={overview ? t('overview.noticeConnected') : t('overview.noticeWaiting')}
      description={overview ? t('overview.noticeConnectedBody') : t('overview.noticeWaitingBody')}
      action={<div className="notice-actions"><StatusBadge tone={maintenance}>{settings ? settings.maintenance ? t('overview.maintenance.on') : t('overview.maintenance.off') : t('overview.maintenance.unknown')}</StatusBadge><Button type="link" size="small" onClick={() => onNavigate('settings')}>{t('overview.configure')} <ArrowUpRight size={14} /></Button></div>}
    />
    <section className="metric-grid">
      <MetricCard label={t('overview.metric.onlineServers')} value={overview ? String(overview.onlineServers) : '—'} note={apiNote} icon={Server} tone="green" onClick={() => onNavigate('servers')} />
      <MetricCard label={t('overview.metric.enabledPlugins')} value={overview ? String(overview.enabledPlugins) : '—'} note={apiNote} icon={Box} tone="blue" onClick={() => onNavigate('plugins')} />
      <MetricCard label={t('overview.metric.domains')} value={overview ? String(overview.domains) : '—'} note={apiNote} icon={Globe2} tone="purple" onClick={() => onNavigate('domains')} />
      <MetricCard label={t('overview.metric.connections')} value={localUsage ? formatNumber(localUsage.activeConnections) : '—'} note={localNote} icon={Zap} tone="amber" onClick={() => onNavigate('usage')} />
    </section>
    <section className="content-grid two-thirds">
      <RequestTrendPanel range={range} setRange={setRange} snapshots={localUsage?.snapshots ?? []} />
      <UsageResourcesPanel settings={settings} usage={usage} localUsage={localUsage} onNavigate={onNavigate} />
    </section>
    <section className="content-grid two-thirds bottom-grid">
      <OverviewActivityPanel audits={audits} onNavigate={onNavigate} />
      <QuickStartPanel onNavigate={onNavigate} />
    </section>
    <OverviewIssuesPanel servers={servers} accessLogs={accessLogs} accessLogsLoading={accessLogsLoading} accessLogsError={accessLogsError} onNavigate={onNavigate} />
  </>
}

