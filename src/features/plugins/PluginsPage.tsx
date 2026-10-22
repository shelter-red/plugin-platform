import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { Activity, Code2, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import type { ApiPlugin } from '../../api'
import i18n from '../../i18n'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'

export function capabilityLabel(plugin: ApiPlugin): string {
  try {
    const manifest = JSON.parse(plugin.manifest_json) as { capabilities?: Record<string, unknown> }
    const labels = [
      ['http', 'HTTP'],
      ['websocket', 'WebSocket'],
      ['sse', 'SSE'],
      ['fileStream', i18n.t('capabilities.fileStream')],
    ].filter(([key]) => manifest.capabilities?.[key] === true).map(([, label]) => label)
    return labels.length > 0 ? labels.join(' + ') : i18n.t('capabilities.none')
  } catch {
    return i18n.t('capabilities.invalid')
  }
}

export function PluginsPage({ plugins, loading, onSync, onLoad, onDetail, onHealth }: { plugins: ApiPlugin[]; loading: boolean; onSync: () => void; onLoad: () => void; onDetail: (id: string) => void; onHealth: (plugin: ApiPlugin) => void }) {
  const { t } = useTranslation()
  const enabled = plugins.filter((plugin) => plugin.state === 'enabled').length
  const columns: TableProps<ApiPlugin>['columns'] = [
    {
      title: t('plugins.columnPlugin'),
      dataIndex: 'name',
      render: (_, plugin) => <div className="cell-title"><div className="table-icon"><Code2 size={15} /></div><div><strong>{plugin.name}</strong><small>{plugin.plugin_id} · v{plugin.version}</small></div></div>,
    },
    { title: t('plugins.columnServer'), dataIndex: 'server_name' },
    {
      title: t('plugins.columnState'),
      dataIndex: 'state',
      render: (state: ApiPlugin['state']) => <StatusBadge tone={state === 'enabled' ? 'success' : state === 'failed' ? 'danger' : 'neutral'}>{t(`status.${state}`, { defaultValue: state })}</StatusBadge>,
    },
    { title: t('plugins.columnCapability'), key: 'capability', render: (_, plugin) => <span className="capability">{capabilityLabel(plugin)}</span> },
    {
      title: t('plugins.columnDomain'),
      dataIndex: 'domain_hostname',
      render: (hostname: string | null) => hostname ? <a href={`https://${hostname}`} target="_blank" rel="noreferrer">{hostname}</a> : <span className="muted">{t('common.notAssigned')}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 88,
      render: (_, plugin) => <div className="row-actions">{plugin.state === 'enabled' && <Button type="text" size="small" onClick={() => onHealth(plugin)} aria-label={t('plugins.health', { name: plugin.name })} title={t('plugins.healthTitle')} icon={<Activity size={16} />} />}<Button type="text" size="small" onClick={() => onDetail(plugin.id)} aria-label={t('plugins.view', { name: plugin.name })} title={t('plugins.viewTitle')} icon={<MoreHorizontal size={17} />} /></div>,
    },
  ]
  return <div className="stack">
    <div className="filter-row"><div className="filter-summary"><span className="filter-dot" />{t('plugins.enabled', { count: enabled })} <span className="divider" />{t('plugins.discovered', { count: plugins.length })}</div><Button size="small" onClick={onSync} loading={loading} icon={<RefreshCw size={14} />}>{t('plugins.sync')}</Button></div>
    {plugins.length === 0
      ? <EmptyState icon={<Code2 size={22} />} title={t('plugins.emptyTitle')} body={t('plugins.emptyBody')}><Button type="primary" onClick={onLoad} icon={<Plus size={15} />}>{t('plugins.load')}</Button></EmptyState>
      : <Panel className="table-panel">
        <Table<ApiPlugin> rowKey="id" size="small" columns={columns} dataSource={plugins} loading={loading} pagination={false} scroll={{ x: 720 }} />
        <div className="table-footer"><span>{t('plugins.footer', { count: plugins.length })}</span><Button type="link" size="small" onClick={onLoad}>{t('plugins.load')} <Plus size={14} /></Button></div>
      </Panel>}
  </div>
}
