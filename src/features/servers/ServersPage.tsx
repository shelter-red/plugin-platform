import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { LockKeyhole, MoreHorizontal, Plus, RefreshCw, Server } from 'lucide-react'
import type { ApiServer } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../lib/format'

export function ServersPage({ servers, loading, onRefresh, onBind, onDetail }: { servers: ApiServer[]; loading: boolean; onRefresh: () => void; onBind: () => void; onDetail: (id: string) => void }) {
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
  return <div className="stack">
    <Panel className="table-panel" title={t('servers.title')} subtitle={t('servers.subtitle')} extra={<Button size="small" onClick={onRefresh} loading={loading} icon={<RefreshCw size={14} />}>{t('servers.refresh')}</Button>}>
      {servers.length === 0
        ? <EmptyState icon={<Server size={22} />} title={t('servers.emptyTitle')} body={t('servers.emptyBody')} />
        : <Table<ApiServer> rowKey="id" size="small" columns={columns} dataSource={servers} loading={loading} pagination={false} scroll={{ x: 640 }} />}
    </Panel>
    <EmptyState icon={<LockKeyhole size={22} />} title={t('servers.bindTitle')} body={t('servers.bindBody')}><Button type="primary" onClick={onBind} icon={<Plus size={15} />}>{t('servers.bind')}</Button></EmptyState>
  </div>
}
