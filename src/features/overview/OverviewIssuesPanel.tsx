import { useTranslation } from 'react-i18next'
import { Alert, Button, List } from 'antd'
import { AlertCircle, ArrowUpRight, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import type { ApiAccessLog, ApiServer } from '../../api'
import type { Page } from '../../app/routes'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { translateError } from '../../errors'
import { formatDateTime } from '../../lib/format'

/**
 * 异常汇总：先列离线/异常服务器，再列最近 3 条 5xx 访问日志。
 * 访问日志还在加载或加载失败时不展示日志条目，避免把「未知」当成「没有错误」。
 */
export function OverviewIssuesPanel({ servers, accessLogs, accessLogsLoading, accessLogsError, onNavigate }: { servers: ApiServer[]; accessLogs: ApiAccessLog[] | null; accessLogsLoading: boolean; accessLogsError: string | null; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const recentErrors = (accessLogs ?? []).filter((log) => log.status >= 500).slice(0, 3)
  const connectionIssues = servers.filter((server) => server.status !== 'online').slice(0, 3)
  return <Panel title={t('overview.errors.title')} subtitle={t('overview.errors.subtitle')} extra={<Button type="link" size="small" onClick={() => onNavigate('logs')}>{t('overview.errors.viewAll')} <ArrowUpRight size={14} /></Button>}>
    {connectionIssues.length > 0 || (!accessLogsError && !accessLogsLoading && recentErrors.length > 0)
      ? <List className="activity-list" rowKey={(item) => item.kind === 'server' ? item.server.id : item.log.id} dataSource={[...connectionIssues.map((server) => ({ kind: 'server' as const, server })), ...recentErrors.map((log) => ({ kind: 'log' as const, log }))]} renderItem={(item) => item.kind === 'server'
        ? <List.Item className="activity-item" key={item.server.id}><div className="activity-mark danger"><Server size={13} /></div><div className="activity-copy"><strong>{item.server.name}</strong><span>{item.server.last_seen_at ? t('servers.lastSeen', { time: formatDateTime(item.server.last_seen_at) }) : t('servers.neverConnected')}</span></div><StatusBadge tone="danger">{t(`status.${item.server.status}`, { defaultValue: item.server.status })}</StatusBadge></List.Item>
        : <List.Item className="activity-item" key={item.log.id}><div className="activity-mark danger"><AlertCircle size={13} /></div><div className="activity-copy"><strong>{item.log.hostname}{item.log.path}</strong><span>{item.log.method} · {item.log.error ?? t('overview.errors.unknownError')}</span></div><StatusBadge tone="danger">{item.log.status}</StatusBadge><time>{formatDateTime(item.log.created_at)}</time></List.Item>} />
      : accessLogsError
        ? <Alert type="error" showIcon message={t('overview.errors.loadFailed')} description={translateError(accessLogsError)} />
        : accessLogsLoading
          ? <EmptyState icon={<RefreshCw size={20} />} title={t('overview.errors.loadingTitle')} body={t('overview.errors.loadingBody')} />
          : <EmptyState icon={<ShieldCheck size={20} />} title={t('overview.errors.emptyTitle')} body={t('overview.errors.emptyBody')} />}
  </Panel>
}
