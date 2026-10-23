import { Cloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { CloudflarePermissionList } from './CloudflarePermissionList'
import { CloudflareTokenScopeGuide } from './CloudflareTokenScopeGuide'
import { CloudflareTokenForm } from './CloudflareTokenForm'
import { CloudflareTokenStatus } from './CloudflareTokenStatus'
import { useCloudflareTokenForm } from './useCloudflareTokenForm'

interface Props {
  settings: CloudflareSettings | null
  onSettingsChange: (settings: CloudflareSettings) => void
  apiLive: boolean
  onAction: Notify
}

/** 系统设置 → Cloudflare：长期 API Token 的录入、验证状态和固定只读权限。 */
export function CloudflarePanel({ settings, onSettingsChange, apiLive, onAction }: Props) {
  const { t } = useTranslation()
  const form = useCloudflareTokenForm(settings, onSettingsChange, onAction)
  const configured = settings?.configured === true
  const tone = configured ? 'success' : settings?.legacyCredential ? 'warning' : 'neutral'
  const status = configured
    ? t('settings.cloudflare.configured')
    : settings?.legacyCredential
      ? t('settings.cloudflare.legacy')
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
    <CloudflareTokenStatus settings={settings} apiLive={apiLive} />
    <CloudflareTokenForm
      settings={settings}
      apiToken={form.apiToken}
      accountId={form.accountId}
      saving={form.saving}
      revoking={form.revoking}
      failure={form.failure}
      onApiTokenChange={form.setApiToken}
      onAccountIdChange={form.setAccountId}
      onSave={() => void form.saveToken()}
      onRevoke={() => void form.revokeToken()}
    />
    <CloudflarePermissionList permissions={settings?.permissions} />
    <CloudflareTokenScopeGuide />
  </Panel>
}
