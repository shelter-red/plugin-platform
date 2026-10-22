import { App, Button, Input } from 'antd'
import { Check, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { revokeOauthSettings, updateOauthSettings, type OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { CLOUDFLARE_SCOPE_FALLBACK } from './cloudflare-auth'
import { oauthSourceLabel, oauthSourceTone } from './oauth-source'

/** 权限说明按 Scope ID 映射到 i18n；Worker 只返回官方名称，说明固定在界面里。 */
const PERMISSION_DESCRIPTION_KEYS: Record<string, string> = {
  'account-settings.read': 'settings.cloudflare.permissions.accountSettings',
  'account-analytics.read': 'settings.cloudflare.permissions.accountAnalytics',
}

interface Props {
  oauth: OauthSettings | null
  onOauthChange: (settings: OauthSettings) => void
  redirect: string
  onAction: Notify
}

/** Cloudflare「OAuth 客户端」区：客户端凭据、只读协议参数、固定权限清单与保存/重置。 */
export function CloudflareClientSection({ oauth, onOauthChange, redirect, onAction }: Props) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [client, setClient] = useState({ clientId: '', clientSecret: '' })
  const [saving, setSaving] = useState<'save' | 'reset' | null>(null)
  const protocol = oauth?.cloudflare
  const scopes = Object.entries(protocol?.scopeNames ?? CLOUDFLARE_SCOPE_FALLBACK)

  useEffect(() => {
    if (!oauth) return
    setClient({ clientId: oauth.cloudflare.clientId ?? '', clientSecret: '' })
  }, [oauth])

  const saveClient = async () => {
    if (!oauth) return onAction('warning', t('settings.oauth.notConnected'))
    setSaving('save')
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

  const resetClient = () => {
    modalApi.confirm({
      title: t('settings.oauth.resetConfirm', { provider: t('settings.cloudflare.clientTitle') }),
      okText: t('settings.oauth.reset'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving('reset')
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

  return <div className="oauth-block">
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

    <div className="protocol-facts" aria-label={t('settings.cloudflare.protocolTitle')}>
      {protocol
        ? <>
          <div><span>{t('settings.cloudflare.protocol.responseType')}（response_type）</span><code>{protocol.responseType}</code></div>
          <div><span>{t('settings.cloudflare.protocol.grantType')}（grant_type）</span><code>{protocol.grantType}</code></div>
          <div><span>{t('settings.cloudflare.protocol.tokenAuthMethod')}（token_endpoint_auth_method）</span><code>{protocol.tokenAuthMethod}</code></div>
        </>
        : <span className="field-hint">{t('settings.cloudflare.protocolUnavailable')}</span>}
    </div>
    <span className="field-hint">{t('settings.cloudflare.protocolHint')}</span>

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

    <div className="settings-actions">
      <Button type="primary" onClick={() => void saveClient()} loading={saving === 'save'} disabled={!oauth || saving !== null}>{t('settings.oauth.save')}</Button>
      {protocol?.source === 'database' && <Button onClick={resetClient} disabled={saving !== null}>{t('settings.oauth.reset')}</Button>}
      <a className="field-link" href="https://developers.cloudflare.com/fundamentals/api/get-started/oauth/" target="_blank" rel="noreferrer">{t('settings.cloudflare.docs')}</a>
    </div>
  </div>
}
