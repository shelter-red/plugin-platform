import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { Copy, Globe2, Plus, RefreshCw } from 'lucide-react'
import type { ApiDomain } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'

export function DomainsPage({ domains, loading, onAction, onRefresh, onAssign }: { domains: ApiDomain[]; loading: boolean; onAction: Notify; onRefresh: () => void; onAssign: () => void }) {
  const { t } = useTranslation()
  const copyDomain = async (hostname: string) => {
    if (!navigator.clipboard) {
      onAction('warning', t('domains.clipboardUnsupported'))
      return
    }
    try {
      await navigator.clipboard.writeText(hostname)
      onAction('success', t('domains.copied'))
    } catch {
      onAction('error', t('domains.copyFailed'))
    }
  }
  const columns: TableProps<ApiDomain>['columns'] = [
    {
      title: t('domains.columnDomain'),
      dataIndex: 'hostname',
      render: (_, domain) => <div className="cell-title"><div className="domain-icon"><Globe2 size={15} /></div><div><strong>{domain.hostname}</strong><small>{domain.plugin_name} · {domain.plugin_instance_id}</small></div></div>,
    },
    {
      title: t('domains.columnStatus'),
      dataIndex: 'status',
      render: (status: ApiDomain['status']) => <StatusBadge tone={status === 'online' ? 'success' : 'warning'}>{t(`status.${status}`, { defaultValue: status })}</StatusBadge>,
    },
    {
      title: t('domains.columnAvailability'),
      dataIndex: 'status',
      render: (status: ApiDomain['status']) => <span className="domain-latency">{status === 'online' ? t('domains.available') : t('domains.waiting')}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 64,
      render: (_, domain) => <Button type="text" size="small" onClick={() => void copyDomain(domain.hostname)} aria-label={t('domains.copy', { hostname: domain.hostname })} title={t('domains.copy', { hostname: domain.hostname })} icon={<Copy size={16} />} />,
    },
  ]
  return <div className="stack">
    <Panel className="table-panel" title={t('domains.title')} subtitle={t('domains.subtitle')} extra={<Button size="small" onClick={onRefresh} loading={loading} icon={<RefreshCw size={14} />}>{t('servers.refresh')}</Button>}>
      {domains.length === 0
        ? <EmptyState icon={<Globe2 size={22} />} title={t('domains.emptyTitle')} body={t('domains.emptyBody')} />
        : <Table<ApiDomain> rowKey="id" size="small" columns={columns} dataSource={domains} loading={loading} pagination={false} scroll={{ x: 640 }} rowClassName={() => 'domain-row'} />}
    </Panel>
    <EmptyState icon={<Globe2 size={22} />} title={t('domains.assignTitle')} body={t('domains.assignBody')}><Button type="primary" onClick={onAssign} icon={<Plus size={15} />}>{t('domains.assign')}</Button></EmptyState>
  </div>
}
