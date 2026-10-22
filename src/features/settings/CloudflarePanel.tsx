import { Alert, Button, Input } from 'antd'
import { ArrowUpRight, Cloud, LockKeyhole, Plus, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { revokeCloudflareSettings, revokeOauthSettings, updateOauthSettings, type CloudflareSettings, type OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { TagListField } from '../../components/TagListField'
import type { Notify } from '../../components/ToastProvider'
import type { CloudflareDiagnosis } from './cloudflare-auth'
import { oauthSourceLabel, oauthSourceTone } from './oauth-source'
import { OauthNotices } from './OauthNotices'

const splitList = (value: string) => value.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean)

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

export function CloudflarePanel({ settings, onSettingsChange, oauth, onOauthChange, diagnosis, onDismissDiagnosis, apiLive, onAction }: Props) {
  const { t } = useTranslation()
  const [client, setClient] = useState({ clientId: '', clientSecret: '', scope: [] as string[] })
  const [saving, setSaving] = useState<'client' | 'revoke' | null>(null)
  const redirect = `${window.location.origin}/auth/cloudflare/callback`
  const protocol = oauth?.cloudflare

  useEffect(() => {
    if (!oauth) return
    setClient({ clientId: oauth.cloudflare.clientId ?? '', clientSecret: '', scope: splitList(oauth.cloudflare.scope) })
  }, [oauth])

  const startAuth = () => { window.location.assign(`${import.meta.env.VITE_API_BASE ?? ''}/auth/cloudflare/start`) }

  const revoke = async () => {
    if (!settings?.configured || !window.confirm(t('settings.cloudflare.revokeConfirm'))) return
    setSaving('revoke')
    try {
      onSettingsChange(await revokeCloudflareSettings())
      onAction('success', t('settings.cloudflare.revoked'))
    } catch {
      onAction('error', t('settings.cloudflare.revokeFailed'))
    } finally {
      setSaving(null)
    }
  }

  const saveClient = async () => {
    if (!oauth) return onAction('warning', t('settings.oauth.notConnected'))
    setSaving('client')
    try {
      onOauthChange(await updateOauthSettings({ cloudflare: { clientId: client.clientId, clientSecret: client.clientSecret, redirectUri: redirect, scope: client.scope.join(' ') } }))
      setClient((current) => ({ ...current, clientSecret: '' }))
      onAction('success', t('settings.cloudflare.clientSaved'))
    } catch {
      onAction('error', t('settings.cloudflare.clientSaveFailed'))
    } finally {
      setSaving(null)
    }
  }

  const resetClient = async () => {
    if (!window.confirm(t('settings.oauth.resetConfirm', { provider: t('settings.cloudflare.clientTitle') }))) return
    setSaving('client')
    try {
      onOauthChange(await revokeOauthSettings('cloudflare'))
      onAction('success', t('settings.oauth.resetDone'))
    } catch {
      onAction('error', t('settings.oauth.resetFailed'))
    } finally {
      setSaving(null)
    }
  }

  const authorizationStatus = settings?.configured
    ? settings.accountIdConfigured ? t('settings.cloudflare.oauthDone') : t('settings.cloudflare.oauthMissingAccount')
    : settings ? t('settings.cloudflare.waitingAdmin') : t('settings.cloudflare.loading')
  const advice = diagnosis?.code === 'access_denied'
    ? t('settings.cloudflare.diagnosisAccessDenied')
    : diagnosis?.code === 'invalid_client'
      ? t('settings.cloudflare.diagnosisInvalidClient')
      : t('settings.cloudflare.diagnosisGeneric')

  return <Panel id="settings-cloudflare" className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Cloud size={18} /></div>
      <div><h2>{t('settings.cloudflare.title')}</h2><p>{t('settings.cloudflare.description')}</p></div>
      <StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? t('settings.cloudflare.authorized') : settings ? t('settings.cloudflare.notConfigured') : apiLive ? t('settings.cloudflare.loadFailed') : t('settings.cloudflare.disconnected')}</StatusBadge>
    </div>
  }>
    <OauthNotices settings={oauth} />

    {diagnosis && <Alert
      className="oauth-notice"
      type="error"
      showIcon
      icon={<ShieldAlert size={16} />}
      data-testid="cloudflare-diagnosis"
      message={t('settings.cloudflare.diagnosisTitle')}
      description={<div className="alert-body">
        <span>{diagnosis.message}</span>
        <span>{advice}</span>
        <span>{t('settings.cloudflare.diagnosisCode')}：{diagnosis.code ?? t('settings.cloudflare.diagnosisUnknownCode')}{diagnosis.description ? ` · ${diagnosis.description}` : ''}</span>
        <Button type="link" size="small" onClick={onDismissDiagnosis}>{t('settings.cloudflare.diagnosisDismiss')}</Button>
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
        {settings?.configured && <Button onClick={() => void revoke()} loading={saving === 'revoke'} disabled={saving !== null}>{t('settings.cloudflare.revoke')}</Button>}
        <span className="form-hint"><LockKeyhole size={13} />{protocol?.configured ? t('settings.cloudflare.hint') : t('settings.cloudflare.clientRequired')}</span>
      </div>
    </div>

    <div className="oauth-block">
      <div className="oauth-block-heading">
        <div><h3>{t('settings.cloudflare.clientTitle')}</h3><p>{t('settings.cloudflare.clientDescription')}</p></div>
        <StatusBadge tone={oauthSourceTone(protocol?.source ?? null)}>{oauthSourceLabel(protocol?.source ?? null, t)}</StatusBadge>
      </div>
      <div className="form-grid">
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientId')}</span>
          <Input value={client.clientId} aria-label={t('settings.oauth.clientId')} onChange={(event) => setClient((current) => ({ ...current, clientId: event.target.value }))} disabled={saving !== null} />
          <a className="field-link" href="https://dash.cloudflare.com/?to=/:account/oauth-clients" target="_blank" rel="noreferrer">{t('settings.cloudflare.createClient')} <Plus size={12} /></a>
        </div>
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientSecret')}</span>
          <Input.Password value={client.clientSecret} aria-label={t('settings.oauth.clientSecret')} onChange={(event) => setClient((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={protocol?.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={saving !== null} />
        </div>
        <CopyField label={t('settings.oauth.redirectUri')} value={redirect} hint={t('settings.oauth.redirectHint')} />
        <TagListField label={t('settings.oauth.scope')} value={client.scope} onChange={(scope) => setClient((current) => ({ ...current, scope }))} hint={t('settings.cloudflare.scopeHint')} lowercase={false} disabled={saving !== null} />
      </div>
      {protocol
        ? <div className="protocol-facts" aria-label={t('settings.cloudflare.protocolTitle')}>
          <div><span>response_type</span><code>{protocol.responseType}</code></div>
          <div><span>grant_type</span><code>{protocol.grantType}</code></div>
          <div><span>token_endpoint_auth_method</span><code>{protocol.tokenAuthMethod}</code></div>
          <div><span>PKCE</span><code>{protocol.pkce ? t('settings.cloudflare.pkceOn') : t('settings.cloudflare.pkceOff')}</code></div>
        </div>
        : <span className="field-hint">{t('settings.cloudflare.protocolUnavailable')}</span>}
      <span className="field-hint">{t('settings.cloudflare.protocolHint')}</span>
      <div className="settings-actions">
        <Button type="primary" onClick={() => void saveClient()} loading={saving === 'client'} disabled={!oauth || saving !== null}>{t('settings.oauth.save')}</Button>
        {protocol?.source === 'database' && <Button onClick={() => void resetClient()} disabled={saving !== null}>{t('settings.oauth.reset')}</Button>}
        <a className="field-link" href="https://developers.cloudflare.com/fundamentals/api/get-started/oauth/" target="_blank" rel="noreferrer">{t('settings.cloudflare.docs')}</a>
      </div>
    </div>
  </Panel>
}
