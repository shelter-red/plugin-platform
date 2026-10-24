import { Alert, Button, Input, Select } from 'antd'
import { ArrowUpRight, KeyRound, RotateCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudflareSettings } from '../../api'
import type { CloudflareRequestFailure } from './useCloudflareCredentialForm'

export function CloudflareCredentialForm({ settings, email, globalApiKey, accountId, saving, revoking, failure, onEmailChange, onGlobalApiKeyChange, onAccountIdChange, onSave, onRevoke }: {
  settings: CloudflareSettings | null
  email: string
  globalApiKey: string
  accountId: string
  saving: boolean
  revoking: boolean
  failure: CloudflareRequestFailure | null
  onEmailChange: (value: string) => void
  onGlobalApiKeyChange: (value: string) => void
  onAccountIdChange: (value: string) => void
  onSave: () => void
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  const busy = saving || revoking
  return <div className="credential-block">
    <div className="credential-block-heading">
      <div><h3>{t('settings.cloudflare.credentialTitle')}</h3><p>{t('settings.cloudflare.credentialDescription')}</p></div>
    </div>
    {failure && <Alert
      className="credential-notice"
      type="error"
      showIcon
      message={failure.status ? t('settings.cloudflare.requestFailed', { status: failure.status }) : t('settings.cloudflare.requestFailedLocal')}
      description={<div className="alert-body"><span>{failure.message}</span>{failure.code && <span>{t('settings.cloudflare.errorCode')}：<code>{failure.code}</code></span>}</div>}
    />}
    <div className="form-grid">
      <label>{t('settings.cloudflare.email')}
        <Input
          aria-label={t('settings.cloudflare.email')}
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="admin@example.com"
          autoComplete="email"
          disabled={busy}
        />
      </label>
      <label>{t('settings.cloudflare.globalApiKey')}
        <Input.Password
          aria-label={t('settings.cloudflare.globalApiKey')}
          value={globalApiKey}
          onChange={(event) => onGlobalApiKeyChange(event.target.value)}
          placeholder={settings?.configured ? t('settings.cloudflare.credentialPlaceholderSaved') : t('settings.cloudflare.credentialPlaceholderNew')}
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
        {settings?.configured ? t('settings.cloudflare.verifyCredential') : t('settings.cloudflare.saveCredential')}
      </Button>
      {settings?.configured && <Button danger onClick={onRevoke} loading={revoking} disabled={busy} icon={<Trash2 size={14} />}>{t('settings.cloudflare.revoke')}</Button>}
      <a className="field-link" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">{t('settings.cloudflare.createCredential')} <ArrowUpRight size={13} /></a>
    </div>
    {failure?.accounts && <label>{t('settings.cloudflare.accountSelect')}
      <Select
        aria-label={t('settings.cloudflare.accountSelect')}
        value={accountId || undefined}
        onChange={onAccountIdChange}
        disabled={busy}
        placeholder={t('settings.cloudflare.accountSelectPlaceholder')}
        options={failure.accounts.map((account) => ({ value: account.id, label: `${account.name || account.id} (${account.id})` }))}
      />
    </label>}
    <p className="form-hint">{t('settings.cloudflare.credentialSecurityHint')}</p>
  </div>
}
