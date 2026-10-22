import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { Copy, Globe2 } from 'lucide-react'
import type { ApiDomain } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'

export function DomainTable({ domains, loading, onCopy }: { domains: ApiDomain[]; loading: boolean; onCopy: (hostname: string) => void }) {
  const { t } = useTranslation()
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
      render: (_, domain) => <Button type="text" size="small" onClick={() => onCopy(domain.hostname)} aria-label={t('domains.copy', { hostname: domain.hostname })} title={t('domains.copy', { hostname: domain.hostname })} icon={<Copy size={16} />} />,
    },
  ]

  return <Table<ApiDomain> rowKey="id" size="small" columns={columns} dataSource={domains} loading={loading} pagination={false} scroll={{ x: 640 }} rowClassName={() => 'domain-row'} />
}
