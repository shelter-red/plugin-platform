import { Alert, Button } from 'antd'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import { diagnosisMessageKey, diagnosisNeedsPermissions, type CloudflareDiagnosis } from './cloudflare-auth'

export function CloudflareAuthDiagnostics({ settings, diagnosis, onDismiss }: {
  settings: CloudflareSettings | null
  diagnosis: CloudflareDiagnosis | null
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const scrollToScopes = () => document.getElementById('settings-cloudflare-scopes')?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  return <>
    {diagnosis && <Alert
      className="oauth-notice"
      type="error"
      showIcon
      icon={<ShieldAlert size={16} />}
      data-testid="cloudflare-diagnosis"
      message={t('settings.cloudflare.diagnosisTitle')}
      description={<div className="alert-body">
        <span>{t(diagnosisMessageKey(diagnosis.code))}</span>
        {diagnosisNeedsPermissions(diagnosis.code) && <span>{t('settings.cloudflare.diagnosisPermissionHint')}</span>}
        <span>{t('settings.cloudflare.diagnosisCode')}：{diagnosis.code}{diagnosis.description ? ` · ${diagnosis.description}` : ''}</span>
        <Button type="link" size="small" onClick={onDismiss}>{t('settings.cloudflare.diagnosisDismiss')}</Button>
      </div>}
    />}

    {settings?.configured && !settings.accountIdConfigured && <Alert
      className="oauth-notice"
      type="warning"
      showIcon
      icon={<ShieldAlert size={16} />}
      message={t('settings.cloudflare.accountMissingTitle')}
      description={<div className="alert-body">
        <span>{t('settings.cloudflare.accountMissingHint')}</span>
        <Button type="link" size="small" onClick={scrollToScopes}>{t('settings.cloudflare.viewPermissions')}</Button>
      </div>}
    />}
  </>
}
