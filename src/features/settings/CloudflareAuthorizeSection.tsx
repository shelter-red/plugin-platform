import { useTranslation } from 'react-i18next'
import type { CloudflareSettings, OauthSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import type { CloudflareDiagnosis } from './cloudflare-auth'
import { CloudflareAccountCard } from './CloudflareAccountCard'
import { CloudflareAuthDiagnostics } from './CloudflareAuthDiagnostics'
import { useCloudflareAuthorization } from './useCloudflareAuthorization'

interface Props {
  settings: CloudflareSettings | null
  onSettingsChange: (settings: CloudflareSettings) => void
  oauth: OauthSettings | null
  diagnosis: CloudflareDiagnosis | null
  onDismissDiagnosis: () => void
  onAction: Notify
}

/** Cloudflare「授权」区：账号标识、授权状态、发起/撤销授权，以及授权诊断。 */
export function CloudflareAuthorizeSection({ settings, onSettingsChange, oauth, diagnosis, onDismissDiagnosis, onAction }: Props) {
  const { t } = useTranslation()
  const { revoking, revoke } = useCloudflareAuthorization(settings, onSettingsChange, onAction)
  const protocol = oauth?.cloudflare
  const authorizationStatus = settings?.configured
    ? settings.accountIdConfigured ? t('settings.cloudflare.oauthDone') : t('settings.cloudflare.oauthMissingAccount')
    : settings ? t('settings.cloudflare.waitingAdmin') : t('settings.cloudflare.loading')

  return <>
    <CloudflareAuthDiagnostics settings={settings} diagnosis={diagnosis} onDismiss={onDismissDiagnosis} />
    <CloudflareAccountCard settings={settings} protocolConfigured={Boolean(protocol?.configured)} authorizationStatus={authorizationStatus} revoking={revoking} onRevoke={revoke} />
  </>
}
