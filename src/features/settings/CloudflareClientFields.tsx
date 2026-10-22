import { useTranslation } from 'react-i18next'
import { Input } from 'antd'
import { Plus } from 'lucide-react'
import type { OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'

export function CloudflareClientFields({ oauth, redirect, client, disabled, onChange, onSecretChange }: {
  oauth: OauthSettings | null
  redirect: string
  client: { clientId: string; clientSecret: string }
  disabled: boolean
  onChange: (clientId: string) => void
  onSecretChange: (clientSecret: string) => void
}) {
  const { t } = useTranslation()
  const protocol = oauth?.cloudflare
  return <div className="form-grid">
    <div className="field">
      <span className="field-label">{t('settings.oauth.clientId')}</span>
      <Input value={client.clientId} aria-label={t('settings.oauth.clientId')} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      <a className="field-link" href="https://dash.cloudflare.com/?to=/:account/oauth-clients" target="_blank" rel="noreferrer">{t('settings.cloudflare.createClient')} <Plus size={12} /></a>
    </div>
    <div className="field">
      <span className="field-label">{t('settings.oauth.clientSecret')}</span>
      <Input.Password value={client.clientSecret} aria-label={t('settings.oauth.clientSecret')} onChange={(event) => onSecretChange(event.target.value)} placeholder={protocol?.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={disabled} />
    </div>
    <CopyField label={t('settings.oauth.redirectUri')} value={redirect} hint={t('settings.oauth.redirectHint')} />
  </div>
}
