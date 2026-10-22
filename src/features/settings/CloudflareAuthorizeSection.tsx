import { Alert, App, Button } from 'antd'
import { ArrowUpRight, LockKeyhole, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { revokeCloudflareSettings, type CloudflareSettings, type OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { diagnosisMessageKey, diagnosisNeedsPermissions, type CloudflareDiagnosis } from './cloudflare-auth'

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
  const modalApi = App.useApp().modal
  const [revoking, setRevoking] = useState(false)
  const protocol = oauth?.cloudflare
  const authorizationStatus = settings?.configured
    ? settings.accountIdConfigured ? t('settings.cloudflare.oauthDone') : t('settings.cloudflare.oauthMissingAccount')
    : settings ? t('settings.cloudflare.waitingAdmin') : t('settings.cloudflare.loading')
  const startAuth = () => { window.location.assign(`${import.meta.env.VITE_API_BASE ?? ''}/auth/cloudflare/start`) }
  const scrollToScopes = () => document.getElementById('settings-cloudflare-scopes')?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const revoke = () => {
    if (!settings?.configured) return
    modalApi.confirm({
      title: t('settings.cloudflare.revokeConfirm'),
      okText: t('settings.cloudflare.revoke'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevoking(true)
        try {
          onSettingsChange(await revokeCloudflareSettings())
          onAction('success', t('settings.cloudflare.revoked'))
        } catch {
          onAction('error', t('settings.cloudflare.revokeFailed'))
        } finally {
          setRevoking(false)
        }
      },
    })
  }

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
        <Button type="link" size="small" onClick={onDismissDiagnosis}>{t('settings.cloudflare.diagnosisDismiss')}</Button>
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

    <div className="oauth-block">
      <div className="oauth-block-heading">
        <div><h3>{t('settings.cloudflare.authorizeTitle')}</h3><p>{t('settings.cloudflare.authorizeDescription')}</p></div>
        <StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? t('settings.cloudflare.authorized') : t('settings.cloudflare.notAuthorized')}</StatusBadge>
      </div>
      <div className="form-grid">
        {settings?.accountId
          ? <CopyField label={t('settings.cloudflare.accountId')} value={settings.accountId} hint={t('settings.cloudflare.accountHint')} />
          : <div className="field"><span className="field-label">{t('settings.cloudflare.accountId')}</span><span className="field-hint">{settings ? t('settings.cloudflare.accountUnknown') : t('settings.cloudflare.loading')}</span></div>}
        <div className="field"><span className="field-label">{t('settings.cloudflare.authStatus')}</span><span className="field-value">{authorizationStatus}</span></div>
      </div>
      <div className="settings-actions">
        <Button type="primary" onClick={startAuth} disabled={!protocol?.configured}>{settings?.configured ? t('settings.cloudflare.reauthorize') : t('settings.cloudflare.start')}<ArrowUpRight size={14} /></Button>
        {settings?.configured && <Button onClick={revoke} loading={revoking} disabled={revoking}>{t('settings.cloudflare.revoke')}</Button>}
        <span className="form-hint"><LockKeyhole size={13} />{protocol?.configured ? t('settings.cloudflare.hint') : t('settings.cloudflare.clientRequired')}</span>
      </div>
    </div>
  </>
}
