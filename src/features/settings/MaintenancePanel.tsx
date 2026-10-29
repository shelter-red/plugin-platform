import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import type { PlatformSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { DomainSuffixForm } from './DomainSuffixForm'
import { MaintenanceToggle } from './MaintenanceToggle'
import { QuotaSettings } from './QuotaSettings'
import { useMaintenanceSettings } from './useMaintenanceSettings'

/** 维护开关、插件域名后缀与平台自身阈值；Cloudflare 官方额度在用量页只读展示。 */
export function MaintenancePanel({ settings, onChange, onAction }: {
  settings: PlatformSettings | null
  onChange: (settings: PlatformSettings) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const state = useMaintenanceSettings(settings, onChange, onAction)

  return <Panel id="settings-maintenance" className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><ShieldCheck size={18} /></div>
      <div><h2>{t('settings.maintenance.title')}</h2><p>{settings ? t('settings.maintenance.description') : t('settings.maintenance.descriptionOffline')}</p></div>
      <StatusBadge tone={state.maintenance ? 'warning' : settings ? 'success' : 'neutral'}>{state.maintenance ? t('settings.maintenance.on') : settings ? t('settings.maintenance.off') : t('settings.maintenance.unknown')}</StatusBadge>
    </div>
  }>
    <MaintenanceToggle settings={settings} maintenance={state.maintenance} saving={state.saving} onToggle={() => void state.toggleMaintenance()} />
    <DomainSuffixForm enabled={Boolean(settings)} value={state.domainSuffix} saving={state.suffixSaving} disabled={state.quotaSaving} canReset={state.canResetDomainSuffix} onChange={state.setDomainSuffix} onSave={() => void state.saveDomainSuffix()} onReset={() => void state.resetDomainSuffix()} />
    <QuotaSettings
      values={state.quotaForm}
      saving={state.quotaSaving}
      disabled={!settings || state.suffixSaving || state.quotaSaving}
      onChange={(key, value) => state.setQuotaForm((current) => ({ ...current, [key]: value }))}
      onSave={() => void state.saveQuotas()}
    />
  </Panel>
}
