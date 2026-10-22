import { Button } from 'antd'
import { ArrowUpRight, LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { StatusBadge } from '../../components/StatusBadge'

export function CloudflareAccountCard({ settings, protocolConfigured, authorizationStatus, revoking, onRevoke }: {
  settings: CloudflareSettings | null
  protocolConfigured: boolean
  authorizationStatus: string
  revoking: boolean
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  const startAuth = () => { window.location.assign(`${import.meta.env.VITE_API_BASE ?? ''}/auth/cloudflare/start`) }

  return <div className="oauth-block">
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
      <Button type="primary" onClick={startAuth} disabled={!protocolConfigured}>{settings?.configured ? t('settings.cloudflare.reauthorize') : t('settings.cloudflare.start')}<ArrowUpRight size={14} /></Button>
      {settings?.configured && <Button onClick={onRevoke} loading={revoking} disabled={revoking}>{t('settings.cloudflare.revoke')}</Button>}
      <span className="form-hint"><LockKeyhole size={13} />{protocolConfigured ? t('settings.cloudflare.hint') : t('settings.cloudflare.clientRequired')}</span>
    </div>
  </div>
}
