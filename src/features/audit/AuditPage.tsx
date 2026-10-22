import { useTranslation } from 'react-i18next'
import { Alert, Button, Table, type TableProps } from 'antd'
import { Activity, Download, ListFilter, RefreshCw } from 'lucide-react'
import type { ApiAudit } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { translateError } from '../../errors'
import { auditActionLabel, auditDetail } from '../../lib/audit'
import { formatDateTime } from '../../lib/format'

export function AuditPage({ audits, loading, error, onExport }: { audits: ApiAudit[]; loading: boolean; error: string | null; onExport: () => void }) {
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
  return <div className="stack">
    {error && <Alert type="error" showIcon message={t('audit.loadFailed')} description={translateError(error)} />}
    <div className="filter-row"><div className="filter-summary"><ListFilter size={15} />{t('audit.allEvents')} <span className="divider" />{t('audit.last180Days')}</div><Button size="small" onClick={onExport} disabled={loading || audits.length === 0} icon={<Download size={14} />}>{t('audit.export')}</Button></div>
    {loading
      ? <EmptyState icon={<RefreshCw size={20} />} title={t('audit.loadingTitle')} body={t('audit.loadingBody')} />
      : audits.length === 0
        ? <EmptyState icon={<Activity size={20} />} title={t('audit.emptyTitle')} body={t('audit.emptyBody')} />
        : <Panel className="table-panel"><Table<ApiAudit> rowKey="id" size="small" columns={columns} dataSource={audits} pagination={false} scroll={{ x: 720 }} /></Panel>}
  </div>
}
