import { useTranslation } from 'react-i18next'
import { Table, type TableProps } from 'antd'
import { Globe2 } from 'lucide-react'
import type { ApiAccessLog } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../lib/format'

export function AccessLogTable({ logs }: { logs: ApiAccessLog[] }) {
  const { t } = useTranslation()
  const columns: TableProps<ApiAccessLog>['columns'] = [
    {
      title: t('logs.columnHost'),
      dataIndex: 'hostname',
      render: (_, log) => <div className="cell-title"><div className="table-icon"><Globe2 size={15} /></div><div><strong>{log.hostname}</strong><small>{log.path}</small></div></div>,
    },
    { title: t('logs.columnServer'), dataIndex: 'server_name', render: (name: string | null) => name ?? '—', responsive: ['md'] },
    { title: t('logs.columnPlugin'), dataIndex: 'plugin_name', render: (name: string | null) => name ?? '—', responsive: ['md'] },
    { title: t('logs.columnRequest'), dataIndex: 'method' },
    {
      title: t('logs.columnStatus'),
      dataIndex: 'status',
      render: (status: number, log) => <StatusBadge tone={status >= 500 ? 'danger' : status >= 400 ? 'warning' : 'success'}>{status}{log.error ? ` · ${log.error}` : ''}</StatusBadge>,
    },
    { title: t('logs.columnPreview'), dataIndex: 'response_preview', render: (preview: string | null) => <span className="log-response-preview" title={preview ?? undefined}>{preview || '—'}</span>, responsive: ['md'], width: 240 },
    { title: t('logs.columnDuration'), dataIndex: 'duration_ms', render: (duration: number) => `${duration} ms` },
    { title: t('logs.columnTime'), dataIndex: 'created_at', render: (createdAt: string) => <span className="muted">{formatDateTime(createdAt)}</span> },
  ]

  return <Table<ApiAccessLog> rowKey="id" size="small" columns={columns} dataSource={logs} pagination={false} scroll={{ x: 1120 }} />
}
