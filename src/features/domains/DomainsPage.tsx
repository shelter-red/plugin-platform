import { useTranslation } from 'react-i18next'
import { App, Button } from 'antd'
import { Globe2, RefreshCw } from 'lucide-react'
import type { ApiDomain } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import type { Notify } from '../../components/ToastProvider'
import { DomainTable } from './DomainTable'
import { useCopyDomain } from './useCopyDomain'

export function DomainsPage({ domains, loading, onAction, onRefresh, onDelete, canDelete }: { domains: ApiDomain[]; loading: boolean; onAction: Notify; onRefresh: () => void; onDelete: (domain: ApiDomain) => Promise<void>; canDelete: boolean }) {
  const { t } = useTranslation()
  const modal = App.useApp().modal
  const copyDomain = useCopyDomain(onAction)
  const confirmDelete = (domain: ApiDomain) => modal.confirm({
    title: t('domains.deleteConfirm', { name: domain.hostname }),
    content: t('domains.deleteWarning'),
    okText: t('domains.deleteAction'),
    cancelText: t('servers.confirmCancel'),
    okButtonProps: { danger: true },
    onOk: () => onDelete(domain),
  })

  return <div className="stack">
    <Panel className="table-panel" title={t('domains.title')} subtitle={t('domains.subtitle')} extra={<Button size="small" onClick={onRefresh} loading={loading} icon={<RefreshCw size={14} />}>{t('servers.refresh')}</Button>}>
      {domains.length === 0
        ? <EmptyState icon={<Globe2 size={22} />} title={t('domains.emptyTitle')} body={t('domains.emptyBody')} />
        : <DomainTable domains={domains} loading={loading} onCopy={(hostname) => void copyDomain(hostname)} onDelete={confirmDelete} canDelete={canDelete} />}
    </Panel>
  </div>
}
