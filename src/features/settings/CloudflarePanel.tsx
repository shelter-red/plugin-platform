import { Alert, App, Button, Input } from 'antd'
import { ArrowUpRight, Check, Cloud, LockKeyhole, Plus, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { revokeCloudflareSettings, revokeOauthSettings, updateOauthSettings, type CloudflareSettings, type OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { CLOUDFLARE_SCOPE_FALLBACK, diagnosisMessageKey, diagnosisNeedsPermissions, type CloudflareDiagnosis } from './cloudflare-auth'
import { oauthSourceLabel, oauthSourceTone } from './oauth-source'
import { OauthNotices } from './OauthNotices'

/** 权限说明按 Scope ID 映射到 i18n；Worker 只返回官方名称，说明固定在界面里。 */
const PERMISSION_DESCRIPTION_KEYS: Record<string, string> = {
  'account-settings.read': 'settings.cloudflare.permissions.accountSettings',
  'account-analytics.read': 'settings.cloudflare.permissions.accountAnalytics',
  offline_access: 'settings.cloudflare.permissions.offlineAccess',
}

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
  const modalApi = App.useApp().modal
  const [client, setClient] = useState({ clientId: '', clientSecret: '' })
  const [saving, setSaving] = useState<'client' | 'revoke' | null>(null)
  const redirect = `${window.location.origin}/auth/cloudflare/callback`
  const protocol = oauth?.cloudflare
  const scopes = Object.entries(protocol?.scopeNames ?? CLOUDFLARE_SCOPE_FALLBACK)

  useEffect(() => {
    if (!oauth) return
    setClient({ clientId: oauth.cloudflare.clientId ?? '', clientSecret: '' })
  }, [oauth])

  const startAuth = () => { window.location.assign(`${import.meta.env.VITE_API_BASE ?? ''}/auth/cloudflare/start`) }
  const scrollToScopes = () => document.getElementById('settings-cloudflare-scopes')?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const revoke = async () => {
    if (!settings?.configured) return
    modalApi.confirm({
      title: t('settings.cloudflare.revokeConfirm'),
      okText: t('settings.cloudflare.revoke'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving('revoke')
        try {
          onSettingsChange(await revokeCloudflareSettings())
          onAction('success', t('settings.cloudflare.revoked'))
        } catch {
          onAction('error', t('settings.cloudflare.revokeFailed'))
        } finally {
          setSaving(null)
        }
      },
    })
  }

  const saveClient = async () => {
    if (!oauth) return onAction('warning', t('settings.oauth.notConnected'))
    setSaving('client')
    try {
      // 授权范围由平台固定，界面不提交 scope；Worker 也会忽略来源里的 scope 字段。
      onOauthChange(await updateOauthSettings({ cloudflare: { clientId: client.clientId, clientSecret: client.clientSecret, redirectUri: redirect } }))
      setClient((current) => ({ ...current, clientSecret: '' }))
      onAction('success', t('settings.cloudflare.clientSaved'))
    } catch {
      onAction('error', t('settings.cloudflare.clientSaveFailed'))
    } finally {
      setSaving(null)
    }
  }

  const resetClient = async () => {
    modalApi.confirm({
      title: t('settings.oauth.resetConfirm', { provider: t('settings.cloudflare.clientTitle') }),
      okText: t('settings.oauth.reset'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving('client')
        try {
          onOauthChange(await revokeOauthSettings('cloudflare'))
          onAction('success', t('settings.oauth.resetDone'))
        } catch {
          onAction('error', t('settings.oauth.resetFailed'))
        } finally {
          setSaving(null)
        }
      },
    })
  }

  const authorizationStatus = settings?.configured
    ? settings.accountIdConfigured ? t('settings.cloudflare.oauthDone') : t('settings.cloudflare.oauthMissingAccount')
    : settings ? t('settings.cloudflare.waitingAdmin') : t('settings.cloudflare.loading')

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
      </div>

      <div className="scope-permissions" id="settings-cloudflare-scopes" data-testid="cloudflare-scopes">
        <div className="scope-permissions-head">
          <span className="field-label">{t('settings.cloudflare.permissionsTitle')}</span>
          <StatusBadge tone="neutral">{t('settings.cloudflare.permissionsFixed')}</StatusBadge>
        </div>
        <p className="field-hint">{t('settings.cloudflare.permissionsHint')}</p>
        <ol className="scope-list">
          {scopes.map(([id, name]) => <li key={id}>
            <Check size={14} aria-hidden="true" />
            <div>
              <strong>{name}</strong>
              <code>{id}</code>
              {PERMISSION_DESCRIPTION_KEYS[id] && <span>{t(PERMISSION_DESCRIPTION_KEYS[id])}</span>}
            </div>
          </li>)}
        </ol>
        <p className="field-hint">{t('settings.cloudflare.permissionsApply')}</p>
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
