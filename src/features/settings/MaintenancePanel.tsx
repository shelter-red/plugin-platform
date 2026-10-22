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

/** 维护开关、插件域名后缀与两组阈值：都写同一个平台设置接口，因此放在一起维护。 */
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
    <DomainSuffixForm enabled={Boolean(settings)} value={state.domainSuffix} saving={state.suffixSaving} disabled={state.quotaSaving} onChange={state.setDomainSuffix} onSave={() => void state.saveDomainSuffix()} />
    <QuotaSettings
      platformValues={state.quotaForm}
      cloudflareValues={state.cloudflareForm}
      saving={state.quotaSaving}
      disabled={!settings || state.suffixSaving || state.quotaSaving}
      onPlatformChange={(key, value) => state.setQuotaForm((current) => ({ ...current, [key]: value }))}
      onCloudflareChange={(key, value) => state.setCloudflareForm((current) => ({ ...current, [key]: value }))}
      onSave={() => void state.saveQuotas()}
    />
  </Panel>
}
