import { useTranslation } from 'react-i18next'
import { Table, type TableProps } from 'antd'
import { Activity } from 'lucide-react'
import type { ApiAudit } from '../../api'
import { auditActionLabel, auditDetail } from '../../lib/audit'
import { formatDateTime } from '../../lib/format'

export function AuditTable({ audits }: { audits: ApiAudit[] }) {
  const { t } = useTranslation()
  const columns: TableProps<ApiAudit>['columns'] = [
    {
      title: t('audit.columnEvent'),
      dataIndex: 'action',
      render: (_, item) => <div className="cell-title"><div className="audit-icon"><Activity size={14} /></div><strong>{auditActionLabel(item.action)}</strong></div>,
    },
    { title: t('audit.columnDetail'), key: 'detail', render: (_, item) => auditDetail(item) },
    {
      title: t('audit.columnActor'),
      key: 'actor',
      render: (_, item) => <span className="operator"><div className="mini-avatar">{(item.actor_name ?? t('common.system')).slice(0, 1)}</div><span>{item.actor_name ?? t('audit.systemEvent')}<small>{item.actor_email ?? t('audit.noIdentity')}</small></span></span>,
    },
    { title: t('audit.columnTime'), dataIndex: 'created_at', render: (createdAt: string) => <span className="muted">{formatDateTime(createdAt)}</span> },
  ]

  return <Table<ApiAudit> rowKey="id" size="small" columns={columns} dataSource={audits} pagination={false} scroll={{ x: 720 }} />
}
