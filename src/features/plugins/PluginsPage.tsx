import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { Code2, RefreshCw } from 'lucide-react'
import type { ApiPlugin } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { PluginTable } from './PluginTable'

export function PluginsPage({ plugins, loading, onSync, onDetail, onHealth }: { plugins: ApiPlugin[]; loading: boolean; onSync: () => void; onDetail: (id: string) => void; onHealth: (plugin: ApiPlugin) => void }) {
  const { t } = useTranslation()
  const enabled = plugins.filter((plugin) => plugin.state === 'enabled').length

  return <div className="stack">
    <div className="filter-row"><div className="filter-summary"><span className="filter-dot" />{t('plugins.enabled', { count: enabled })} <span className="divider" />{t('plugins.discovered', { count: plugins.length })}</div><Button size="small" onClick={onSync} loading={loading} icon={<RefreshCw size={14} />}>{t('plugins.sync')}</Button></div>
    {plugins.length === 0
      ? <EmptyState icon={<Code2 size={22} />} title={t('plugins.emptyTitle')} body={t('plugins.emptyBody')} />
      : <Panel className="table-panel">
        <PluginTable plugins={plugins} loading={loading} onDetail={onDetail} onHealth={onHealth} />
        <div className="table-footer"><span>{t('plugins.footer', { count: plugins.length })}</span></div>
      </Panel>}
  </div>
}
