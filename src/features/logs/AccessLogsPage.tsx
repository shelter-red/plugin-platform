import { useTranslation } from 'react-i18next'
import { Alert, Button, Table, type TableProps } from 'antd'
import { Activity, Download, Globe2, RefreshCw } from 'lucide-react'
import type { ApiAccessLog } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { translateError } from '../../errors'
import { formatDateTime } from '../../lib/format'

export function AccessLogsPage({ logs, loading, error, onExport }: { logs: ApiAccessLog[]; loading: boolean; error: string | null; onExport: () => void }) {
  const { t } = useTranslation()
  const errors = logs.filter((log) => log.status >= 500).length
  const columns: TableProps<ApiAccessLog>['columns'] = [
    {
      title: t('logs.columnHost'),
      dataIndex: 'hostname',
      render: (_, log) => <div className="cell-title"><div className="table-icon"><Globe2 size={15} /></div><div><strong>{log.hostname}</strong><small>{log.path}</small></div></div>,
    },
    { title: t('logs.columnRequest'), dataIndex: 'method' },
    {
      title: t('logs.columnStatus'),
      dataIndex: 'status',
      render: (status: number, log) => <StatusBadge tone={status >= 500 ? 'danger' : status >= 400 ? 'warning' : 'success'}>{status}{log.error ? ` · ${log.error}` : ''}</StatusBadge>,
    },
    { title: t('logs.columnDuration'), dataIndex: 'duration_ms', render: (duration: number) => `${duration} ms` },
    { title: t('logs.columnTime'), dataIndex: 'created_at', render: (createdAt: string) => <span className="muted">{formatDateTime(createdAt)}</span> },
  ]
  return <div className="stack">
    {error && <Alert type="error" showIcon message={t('logs.loadFailed')} description={translateError(error)} />}
    <div className="filter-row"><div className="filter-summary"><Activity size={15} />{t('logs.last30Days')} <span className="divider" />{t('logs.errors', { count: errors })}</div><Button size="small" onClick={onExport} disabled={loading || logs.length === 0} icon={<Download size={14} />}>{t('logs.export')}</Button></div>
    {loading
      ? <EmptyState icon={<RefreshCw size={20} />} title={t('logs.loadingTitle')} body={t('logs.loadingBody')} />
      : logs.length === 0
        ? <EmptyState icon={<Activity size={20} />} title={t('logs.emptyTitle')} body={t('logs.emptyBody')} />
        : <Panel className="table-panel"><Table<ApiAccessLog> rowKey="id" size="small" columns={columns} dataSource={logs} pagination={false} scroll={{ x: 720 }} /></Panel>}
  </div>
}
