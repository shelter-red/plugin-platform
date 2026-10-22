import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { Activity, Code2, MoreHorizontal } from 'lucide-react'
import type { ApiPlugin } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import { capabilityLabel } from './capability'

export function PluginTable({ plugins, loading, onDetail, onHealth }: { plugins: ApiPlugin[]; loading: boolean; onDetail: (id: string) => void; onHealth: (plugin: ApiPlugin) => void }) {
  const { t } = useTranslation()
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

  return <Table<ApiPlugin> rowKey="id" size="small" columns={columns} dataSource={plugins} loading={loading} pagination={false} scroll={{ x: 720 }} />
}
