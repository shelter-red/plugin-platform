import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { RefreshCw, Server } from 'lucide-react'
import type { ApiServer } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { ServerTable } from './ServerTable'

export function ServersPage({ servers, loading, onRefresh, onDetail }: { servers: ApiServer[]; loading: boolean; onRefresh: () => void; onDetail: (id: string) => void }) {
  const { t } = useTranslation()

  return <div className="stack">
    <Panel className="table-panel" title={t('servers.title')} subtitle={t('servers.subtitle')} extra={<Button size="small" onClick={onRefresh} loading={loading} icon={<RefreshCw size={14} />}>{t('servers.refresh')}</Button>}>
      {servers.length === 0
        ? <EmptyState icon={<Server size={22} />} title={t('servers.emptyTitle')} body={t('servers.emptyBody')} />
        : <ServerTable servers={servers} loading={loading} onDetail={onDetail} />}
    </Panel>
  </div>
}
