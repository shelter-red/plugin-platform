import { Alert, Button, Input } from 'antd'
import { ArrowUpRight, KeyRound, RotateCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import type { CloudflareRequestFailure } from './useCloudflareTokenForm'

export function CloudflareTokenForm({ settings, apiToken, accountId, saving, revoking, failure, onApiTokenChange, onAccountIdChange, onSave, onRevoke }: {
  settings: CloudflareSettings | null
  apiToken: string
  accountId: string
  saving: boolean
  revoking: boolean
  failure: CloudflareRequestFailure | null
  onApiTokenChange: (value: string) => void
  onAccountIdChange: (value: string) => void
  onSave: () => void
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  const busy = saving || revoking
  return <div className="oauth-block">
    <div className="oauth-block-heading">
      <div><h3>{t('settings.cloudflare.tokenTitle')}</h3><p>{t('settings.cloudflare.tokenDescription')}</p></div>
    </div>
    {failure && <Alert
      className="oauth-notice"
      type="error"
      showIcon
      message={failure.status ? t('settings.cloudflare.requestFailed', { status: failure.status }) : t('settings.cloudflare.requestFailedLocal')}
      description={<div className="alert-body"><span>{failure.message}</span>{failure.code && <span>{t('settings.cloudflare.errorCode')}：<code>{failure.code}</code></span>}</div>}
    />}
    <div className="form-grid">
      <label>{t('settings.cloudflare.apiToken')}
        <Input.Password
          aria-label={t('settings.cloudflare.apiToken')}
          value={apiToken}
          onChange={(event) => onApiTokenChange(event.target.value)}
          placeholder={settings?.configured ? t('settings.cloudflare.tokenPlaceholderSaved') : t('settings.cloudflare.tokenPlaceholderNew')}
          autoComplete="new-password"
          disabled={busy}
        />
      </label>
      <label>{t('settings.cloudflare.accountIdOptional')}
        <Input
          aria-label={t('settings.cloudflare.accountIdOptional')}
          value={accountId}
          onChange={(event) => onAccountIdChange(event.target.value)}
          placeholder={t('settings.cloudflare.accountIdPlaceholder')}
          disabled={busy}
        />
      </label>
    </div>
    <div className="settings-actions">
      <Button type="primary" onClick={onSave} loading={saving} disabled={busy} icon={settings?.configured ? <RotateCw size={14} /> : <KeyRound size={14} />}>
        {settings?.configured ? t('settings.cloudflare.verifyToken') : t('settings.cloudflare.saveToken')}
      </Button>
      {settings?.configured && <Button danger onClick={onRevoke} loading={revoking} disabled={busy} icon={<Trash2 size={14} />}>{t('settings.cloudflare.revoke')}</Button>}
      <a className="field-link" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">{t('settings.cloudflare.createToken')} <ArrowUpRight size={13} /></a>
    </div>
    <p className="form-hint">{t('settings.cloudflare.tokenSecurityHint')}</p>
  </div>
}
