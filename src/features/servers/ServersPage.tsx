import { useTranslation } from 'react-i18next'
import { App, Button } from 'antd'
import { RefreshCw, Server } from 'lucide-react'
import type { ApiServer } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { ServerTable } from './ServerTable'

export function ServersPage({ servers, loading, onRefresh, onDetail, onDelete, canDelete }: { servers: ApiServer[]; loading: boolean; onRefresh: () => void; onDetail: (id: string) => void; onDelete: (server: ApiServer) => Promise<void>; canDelete: boolean }) {
  const { t } = useTranslation()
  const modal = App.useApp().modal
  const confirmDelete = (server: ApiServer) => modal.confirm({
    title: t('servers.deleteConfirm', { name: server.name }),
    content: t('servers.deleteWarning'),
    okText: t('servers.deleteAction'),
    cancelText: t('servers.confirmCancel'),
    okButtonProps: { danger: true },
    onOk: () => onDelete(server),
  })

  return <div className="stack">
    <Panel className="table-panel" title={t('servers.title')} subtitle={t('servers.subtitle')} extra={<Button size="small" onClick={onRefresh} loading={loading} icon={<RefreshCw size={14} />}>{t('servers.refresh')}</Button>}>
      {servers.length === 0
        ? <EmptyState icon={<Server size={22} />} title={t('servers.emptyTitle')} body={t('servers.emptyBody')} />
        : <ServerTable servers={servers} loading={loading} onDetail={onDetail} onDelete={confirmDelete} canDelete={canDelete} />}
    </Panel>
  </div>
}
