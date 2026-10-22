import { Cloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings, OauthSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import type { CloudflareDiagnosis } from './cloudflare-auth'
import { CloudflareAuthorizeSection } from './CloudflareAuthorizeSection'
import { CloudflareClientSection } from './CloudflareClientSection'
import { OauthNotices } from './OauthNotices'

interface Props {
  settings: CloudflareSettings | null
  onSettingsChange: (settings: CloudflareSettings) => void
  oauth: OauthSettings | null
  onOauthChange: (settings: OauthSettings) => void
  diagnosis: CloudflareDiagnosis | null
  onDismissDiagnosis: () => void
  apiLive: boolean
  onAction: Notify
}

/** 系统设置 → Cloudflare：授权与 OAuth 客户端两区，授权诊断由授权区承载。 */
export function CloudflarePanel({ settings, onSettingsChange, oauth, onOauthChange, diagnosis, onDismissDiagnosis, apiLive, onAction }: Props) {
  const { t } = useTranslation()
  const redirect = `${window.location.origin}/auth/cloudflare/callback`
  return <Panel id="settings-cloudflare" className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Cloud size={18} /></div>
      <div><h2>{t('settings.cloudflare.title')}</h2><p>{t('settings.cloudflare.description')}</p></div>
      <StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? t('settings.cloudflare.authorized') : settings ? t('settings.cloudflare.notConfigured') : apiLive ? t('settings.cloudflare.loadFailed') : t('settings.cloudflare.disconnected')}</StatusBadge>
    </div>
  }>
    <OauthNotices settings={oauth} />
    <CloudflareAuthorizeSection settings={settings} onSettingsChange={onSettingsChange} oauth={oauth} diagnosis={diagnosis} onDismissDiagnosis={onDismissDiagnosis} onAction={onAction} />
    <CloudflareClientSection oauth={oauth} onOauthChange={onOauthChange} redirect={redirect} onAction={onAction} />
  </Panel>
}
