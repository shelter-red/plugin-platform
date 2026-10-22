import { useTranslation } from 'react-i18next'
import { Alert, Button } from 'antd'
import { Activity, Download, ListFilter, RefreshCw } from 'lucide-react'
import type { ApiAudit } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { translateError } from '../../errors'
import { AuditTable } from './AuditTable'

export function AuditPage({ audits, loading, error, onExport }: { audits: ApiAudit[]; loading: boolean; error: string | null; onExport: () => void }) {
  const { t } = useTranslation()

  return <div className="stack">
    {error && <Alert type="error" showIcon message={t('audit.loadFailed')} description={translateError(error)} />}
    <div className="filter-row"><div className="filter-summary"><ListFilter size={15} />{t('audit.allEvents')} <span className="divider" />{t('audit.last180Days')}</div><Button size="small" onClick={onExport} disabled={loading || audits.length === 0} icon={<Download size={14} />}>{t('audit.export')}</Button></div>
    {loading
      ? <EmptyState icon={<RefreshCw size={20} />} title={t('audit.loadingTitle')} body={t('audit.loadingBody')} />
      : audits.length === 0
        ? <EmptyState icon={<Activity size={20} />} title={t('audit.emptyTitle')} body={t('audit.emptyBody')} />
        : <Panel className="table-panel"><AuditTable audits={audits} /></Panel>}
  </div>
}
