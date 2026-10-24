import { Cloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { CloudflareCredentialForm } from './CloudflareCredentialForm'
import { CloudflareCredentialStatus } from './CloudflareCredentialStatus'
import { useCloudflareCredentialForm } from './useCloudflareCredentialForm'

interface Props {
  settings: CloudflareSettings | null
  onSettingsChange: (settings: CloudflareSettings) => void
  apiLive: boolean
  onAction: Notify
}

/** 系统设置 → Cloudflare：Email + Global API Key 的录入与验证。 */
export function CloudflarePanel({ settings, onSettingsChange, apiLive, onAction }: Props) {
  const { t } = useTranslation()
  const form = useCloudflareCredentialForm(settings, onSettingsChange, onAction)
  const configured = settings?.configured === true
  const tone = configured ? 'success' : 'neutral'
  const status = configured
    ? t('settings.cloudflare.configured')
    : settings
        ? t('settings.cloudflare.notConfigured')
        : apiLive
          ? t('settings.cloudflare.loadFailed')
          : t('settings.cloudflare.disconnected')

  return <Panel id="settings-cloudflare" className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Cloud size={18} /></div>
      <div><h2>{t('settings.cloudflare.title')}</h2><p>{t('settings.cloudflare.description')}</p></div>
      <StatusBadge tone={tone}>{status}</StatusBadge>
    </div>
  }>
    <CloudflareCredentialStatus settings={settings} apiLive={apiLive} />
    <CloudflareCredentialForm
      settings={settings}
      email={form.email}
      globalApiKey={form.globalApiKey}
      accountId={form.accountId}
      saving={form.saving}
      revoking={form.revoking}
      failure={form.failure}
      onEmailChange={form.setEmail}
      onGlobalApiKeyChange={form.setGlobalApiKey}
      onAccountIdChange={form.setAccountId}
      onSave={() => void form.saveCredential()}
      onRevoke={() => void form.revokeCredential()}
    />
  </Panel>
}
