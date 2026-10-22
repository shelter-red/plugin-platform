import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { Globe2, Plus, RefreshCw } from 'lucide-react'
import type { ApiDomain } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import type { Notify } from '../../components/ToastProvider'
import { DomainTable } from './DomainTable'
import { useCopyDomain } from './useCopyDomain'

export function DomainsPage({ domains, loading, onAction, onRefresh, onAssign }: { domains: ApiDomain[]; loading: boolean; onAction: Notify; onRefresh: () => void; onAssign: () => void }) {
  const { t } = useTranslation()
  const copyDomain = useCopyDomain(onAction)

  return <div className="stack">
    <Panel className="table-panel" title={t('domains.title')} subtitle={t('domains.subtitle')} extra={<Button size="small" onClick={onRefresh} loading={loading} icon={<RefreshCw size={14} />}>{t('servers.refresh')}</Button>}>
      {domains.length === 0
        ? <EmptyState icon={<Globe2 size={22} />} title={t('domains.emptyTitle')} body={t('domains.emptyBody')} />
        : <DomainTable domains={domains} loading={loading} onCopy={(hostname) => void copyDomain(hostname)} />}
    </Panel>
    <EmptyState icon={<Globe2 size={22} />} title={t('domains.assignTitle')} body={t('domains.assignBody')}><Button type="primary" onClick={onAssign} icon={<Plus size={15} />}>{t('domains.assign')}</Button></EmptyState>
  </div>
}
