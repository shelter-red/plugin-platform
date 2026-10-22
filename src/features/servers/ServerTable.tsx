import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { MoreHorizontal, Server } from 'lucide-react'
import type { ApiServer } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../lib/format'

export function ServerTable({ servers, loading, onDetail }: { servers: ApiServer[]; loading: boolean; onDetail: (id: string) => void }) {
  const { t } = useTranslation()
  const columns: TableProps<ApiServer>['columns'] = [
    {
      title: t('servers.columnServer'),
      dataIndex: 'name',
      render: (_, server) => <div className="cell-title"><div className="table-icon"><Server size={15} /></div><div><strong>{server.name}</strong><small>{server.id} · {t('common.protocolVersion')}</small></div></div>,
    },
    {
      title: t('servers.columnStatus'),
      dataIndex: 'status',
      render: (status: ApiServer['status']) => <StatusBadge tone={status === 'online' ? 'success' : status === 'revoked' ? 'danger' : 'warning'}>{t(`status.${status}`, { defaultValue: status })}</StatusBadge>,
    },
    {
      title: t('servers.columnLastSeen'),
      dataIndex: 'last_seen_at',
      render: (lastSeen: string | null) => <span className="muted">{lastSeen ? t('servers.lastSeen', { time: formatDateTime(lastSeen) }) : t('servers.neverConnected')}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 64,
      render: (_, server) => <Button type="text" size="small" onClick={() => onDetail(server.id)} aria-label={t('servers.view', { name: server.name })} title={t('servers.viewTitle')} icon={<MoreHorizontal size={17} />} />,
    },
  ]

  return <Table<ApiServer> rowKey="id" size="small" columns={columns} dataSource={servers} loading={loading} pagination={false} scroll={{ x: 640 }} />
}
