import { useTranslation } from 'react-i18next'
import { Copy, Globe2, Plus, RefreshCw } from 'lucide-react'
import type { ApiDomain } from '../../api'
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
  return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>{t('domains.title')}</h2><p>{t('domains.subtitle')}</p></div><button className="button secondary small" onClick={onRefresh} disabled={loading}><RefreshCw size={14} />{t('servers.refresh')}</button></div>{domains.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>{t('domains.emptyTitle')}</h3><p>{t('domains.emptyBody')}</p></div> : <div className="domain-list">{domains.map((domain) => <div className="domain-row" key={domain.id}><div className="domain-icon"><Globe2 size={17} /></div><div className="domain-main"><strong>{domain.hostname}</strong><span>{domain.plugin_name} · {domain.plugin_instance_id}</span></div><StatusBadge tone={domain.status === 'online' ? 'success' : 'warning'}>{t(`status.${domain.status}`, { defaultValue: domain.status })}</StatusBadge><span className="domain-latency">{domain.status === 'online' ? t('domains.available') : t('domains.waiting')}</span><button className="row-action" onClick={() => void copyDomain(domain.hostname)} aria-label={t('domains.copy', { hostname: domain.hostname })} title={t('domains.copy', { hostname: domain.hostname })}><Copy size={16} /></button></div>)}</div>}</div><div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>{t('domains.assignTitle')}</h3><p>{t('domains.assignBody')}</p><button className="button primary" onClick={onAssign}><Plus size={15} />{t('domains.assign')}</button></div></div>
}
