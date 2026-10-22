import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, Download, Globe2, RefreshCw } from 'lucide-react'
import type { ApiAccessLog } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { translateError } from '../../errors'
import { formatDateTime } from '../../lib/format'

export function AccessLogsPage({ logs, loading, error, onExport }: { logs: ApiAccessLog[]; loading: boolean; error: string | null; onExport: () => void }) {
  const { t } = useTranslation()
  const errors = logs.filter((log) => log.status >= 500).length
  return <div className="stack">{error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('logs.loadFailed')}</strong><span>{translateError(error)}</span></div></div>}<div className="filter-row"><div className="filter-summary"><Activity size={15} />{t('logs.last30Days')} <span className="divider" />{t('logs.errors', { count: errors })}</div><button className="button secondary small" onClick={onExport} disabled={loading || logs.length === 0}><Download size={14} />{t('logs.export')}</button></div>{loading ? <div className="empty-panel"><div className="empty-illustration"><RefreshCw size={20} /></div><h3>{t('logs.loadingTitle')}</h3><p>{t('logs.loadingBody')}</p></div> : logs.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>{t('logs.emptyTitle')}</h3><p>{t('logs.emptyBody')}</p></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>{t('logs.columnHost')}</th><th>{t('logs.columnRequest')}</th><th>{t('logs.columnStatus')}</th><th>{t('logs.columnDuration')}</th><th>{t('logs.columnTime')}</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td><div className="cell-title"><div className="table-icon"><Globe2 size={15} /></div><div><strong>{log.hostname}</strong><small>{log.path}</small></div></div></td><td>{log.method}</td><td><StatusBadge tone={log.status >= 500 ? 'danger' : log.status >= 400 ? 'warning' : 'success'}>{log.status}{log.error ? ` · ${log.error}` : ''}</StatusBadge></td><td>{log.duration_ms} ms</td><td className="muted">{formatDateTime(log.created_at)}</td></tr>)}</tbody></table></div></div>}</div>
}
