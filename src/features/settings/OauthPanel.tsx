import { Button, Input } from 'antd'
import { KeyRound, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { revokeOauthSettings, updateOauthSettings, type OauthProvider, type OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { TagListField } from '../../components/TagListField'
import type { Notify } from '../../components/ToastProvider'

const splitList = (value: string) => value.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean)

function sourceLabel(source: OauthSettings['github']['source'], t: (key: string) => string) {
  return source === 'database' ? t('settings.oauth.sourceDatabase') : source === 'environment' ? t('settings.oauth.sourceEnvironment') : t('settings.oauth.sourceNone')
}

export function OauthPanel({ settings, onChange, onAction }: { settings: OauthSettings | null; onChange: (settings: OauthSettings) => void; onAction: Notify }) {
  const { t } = useTranslation()
  const [github, setGithub] = useState({ clientId: '', clientSecret: '', allowlist: [] as string[] })
  const [cloudflare, setCloudflare] = useState({ clientId: '', clientSecret: '', scope: [] as string[] })
  const [saving, setSaving] = useState<OauthProvider | null>(null)
  const githubRedirect = `${window.location.origin}/auth/github/callback`
  const cloudflareRedirect = `${window.location.origin}/auth/cloudflare/callback`

  useEffect(() => {
    if (!settings) return
    setGithub({ clientId: settings.github.clientId ?? '', clientSecret: '', allowlist: splitList(settings.github.allowlist) })
    setCloudflare({ clientId: settings.cloudflare.clientId ?? '', clientSecret: '', scope: splitList(settings.cloudflare.scope) })
  }, [settings])

  const sourceTone = (source: OauthSettings['github']['source']) => source === 'database' ? 'success' : source === 'environment' ? 'warning' : 'neutral'

  const save = async (provider: OauthProvider) => {
    if (!settings) return onAction('warning', t('settings.oauth.notConnected'))
    setSaving(provider)
    try {
      const next = provider === 'github'
        ? await updateOauthSettings({ github: { clientId: github.clientId, clientSecret: github.clientSecret, redirectUri: githubRedirect, allowlist: github.allowlist.join(', ') } })
        : await updateOauthSettings({ cloudflare: { clientId: cloudflare.clientId, clientSecret: cloudflare.clientSecret, redirectUri: cloudflareRedirect, scope: cloudflare.scope.join(' ') } })
      onChange(next)
      if (provider === 'github') setGithub((current) => ({ ...current, clientSecret: '' }))
      else setCloudflare((current) => ({ ...current, clientSecret: '' }))
      onAction('success', t('settings.oauth.saved'))
    } catch {
      onAction('error', t('settings.oauth.saveFailed'))
    } finally {
      setSaving(null)
    }
  }

  const reset = async (provider: OauthProvider) => {
    if (!window.confirm(t('settings.oauth.resetConfirm', { provider: provider === 'github' ? t('settings.oauth.githubTitle') : t('settings.oauth.cloudflareTitle') }))) return
    setSaving(provider)
    try {
      onChange(await revokeOauthSettings(provider))
      onAction('success', t('settings.oauth.resetDone'))
    } catch {
      onAction('error', t('settings.oauth.resetFailed'))
    } finally {
      setSaving(null)
    }
  }

  const disabled = !settings || saving !== null
  return <div className="panel settings-panel">
    <div className="settings-heading">
      <div className="settings-icon"><KeyRound size={18} /></div>
      <div><h2>{t('settings.oauth.title')}</h2><p>{t('settings.oauth.description')}</p></div>
      <span className={`status-badge ${settings && (settings.github.configured || settings.cloudflare.configured) ? 'success' : 'neutral'}`}><span className="status-dot" />{settings ? t('settings.oauth.configuredCount', { count: Number(settings.github.configured) + Number(settings.cloudflare.configured) }) : t('settings.oauth.unknown')}</span>
    </div>
    {settings?.unreadable && <div className="notice-bar compact oauth-notice"><div className="notice-icon"><KeyRound size={16} /></div><div><strong>{t('settings.oauth.unreadable')}</strong></div></div>}
    {settings && !settings.sessionSecretConfigured && <div className="notice-bar compact oauth-notice"><div className="notice-icon"><KeyRound size={16} /></div><div><strong>{t('settings.oauth.sessionSecretMissing')}</strong></div></div>}

    <div className="oauth-block">
      <div className="oauth-block-heading">
        <div><h3>{t('settings.oauth.githubTitle')}</h3><p>{t('settings.oauth.githubDescription')}</p></div>
        <span className={`status-badge ${sourceTone(settings?.github.source ?? null)}`}><span className="status-dot" />{sourceLabel(settings?.github.source ?? null, t)}</span>
      </div>
      <div className="form-grid">
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientId')}</span>
          <Input value={github.clientId} aria-label={t('settings.oauth.clientId')} onChange={(event) => setGithub((current) => ({ ...current, clientId: event.target.value }))} placeholder="Iv1.0123456789abcdef" disabled={disabled} />
          <a className="field-link" href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">{t('settings.oauth.createGithubApp')} <Plus size={12} /></a>
        </div>
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientSecret')}</span>
          <Input.Password value={github.clientSecret} aria-label={t('settings.oauth.clientSecret')} onChange={(event) => setGithub((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={settings?.github.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={disabled} />
        </div>
        <CopyField label={t('settings.oauth.redirectUri')} value={githubRedirect} hint={t('settings.oauth.redirectHint')} />
        <TagListField label={t('settings.oauth.allowlist')} value={github.allowlist} onChange={(allowlist) => setGithub((current) => ({ ...current, allowlist }))} hint={t('settings.oauth.allowlistHint')} placeholder="octocat, admin@example.com" disabled={disabled} />
      </div>
      <div className="settings-actions">
        <Button type="primary" onClick={() => void save('github')} disabled={disabled}>{saving === 'github' ? t('common.saving') : t('settings.oauth.save')}</Button>
        {settings?.github.source === 'database' && <Button onClick={() => void reset('github')} disabled={saving !== null}>{t('settings.oauth.reset')}</Button>}
      </div>
    </div>

    <div className="oauth-block">
      <div className="oauth-block-heading">
        <div><h3>{t('settings.oauth.cloudflareTitle')}</h3><p>{t('settings.oauth.cloudflareDescription')}</p></div>
        <span className={`status-badge ${sourceTone(settings?.cloudflare.source ?? null)}`}><span className="status-dot" />{sourceLabel(settings?.cloudflare.source ?? null, t)}</span>
      </div>
      <div className="form-grid">
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientId')}</span>
          <Input value={cloudflare.clientId} aria-label={t('settings.oauth.clientId')} onChange={(event) => setCloudflare((current) => ({ ...current, clientId: event.target.value }))} disabled={disabled} />
          <a className="field-link" href="https://dash.cloudflare.com/?to=/:account/oauth-clients" target="_blank" rel="noreferrer">{t('settings.oauth.createCloudflareClient')} <Plus size={12} /></a>
        </div>
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientSecret')}</span>
          <Input.Password value={cloudflare.clientSecret} aria-label={t('settings.oauth.clientSecret')} onChange={(event) => setCloudflare((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={settings?.cloudflare.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={disabled} />
        </div>
        <CopyField label={t('settings.oauth.redirectUri')} value={cloudflareRedirect} hint={t('settings.oauth.redirectHint')} />
        <TagListField label={t('settings.oauth.scope')} value={cloudflare.scope} onChange={(scope) => setCloudflare((current) => ({ ...current, scope }))} hint={t('settings.oauth.scopeHint')} lowercase={false} disabled={disabled} />
      </div>
      <div className="settings-actions">
        <Button type="primary" onClick={() => void save('cloudflare')} disabled={disabled}>{saving === 'cloudflare' ? t('common.saving') : t('settings.oauth.save')}</Button>
        {settings?.cloudflare.source === 'database' && <Button onClick={() => void reset('cloudflare')} disabled={saving !== null}>{t('settings.oauth.reset')}</Button>}
        <a className="field-link" href="https://developers.cloudflare.com/fundamentals/api/get-started/oauth/" target="_blank" rel="noreferrer">{t('settings.oauth.cloudflareDocs')}</a>
      </div>
    </div>
  </div>
}
