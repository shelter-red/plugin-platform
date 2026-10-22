import { App, Button, Input } from 'antd'
import { LogIn, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { revokeOauthSettings, updateOauthSettings, type OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { TagListField } from '../../components/TagListField'
import type { Notify } from '../../components/ToastProvider'
import { oauthSourceLabel, oauthSourceTone } from './oauth-source'
import { OauthNotices } from './OauthNotices'

const splitList = (value: string) => value.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean)

export function OauthPanel({ settings, onChange, onAction }: { settings: OauthSettings | null; onChange: (settings: OauthSettings) => void; onAction: Notify }) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [github, setGithub] = useState({ clientId: '', clientSecret: '', allowlist: [] as string[] })
  const [saving, setSaving] = useState(false)
  const redirect = `${window.location.origin}/auth/github/callback`

  useEffect(() => {
    if (!settings) return
    setGithub({ clientId: settings.github.clientId ?? '', clientSecret: '', allowlist: splitList(settings.github.allowlist) })
  }, [settings])

  const save = async () => {
    if (!settings) return onAction('warning', t('settings.oauth.notConnected'))
    setSaving(true)
    try {
      onChange(await updateOauthSettings({ github: { clientId: github.clientId, clientSecret: github.clientSecret, redirectUri: redirect, allowlist: github.allowlist.join(', ') } }))
      setGithub((current) => ({ ...current, clientSecret: '' }))
      onAction('success', t('settings.oauth.saved'))
    } catch {
      onAction('error', t('settings.oauth.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    modalApi.confirm({
      title: t('settings.oauth.reset'),
      content: t('settings.oauth.resetConfirm', { provider: t('settings.oauth.githubTitle') }),
      okText: t('settings.oauth.reset'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(true)
        try {
          onChange(await revokeOauthSettings('github'))
          onAction('success', t('settings.oauth.resetDone'))
        } catch {
          onAction('error', t('settings.oauth.resetFailed'))
        } finally {
          setSaving(false)
        }
      },
    })
  }

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><LogIn size={18} /></div>
      <div><h2>{t('settings.oauth.githubTitle')}</h2><p>{t('settings.oauth.githubDescription')}</p></div>
      <StatusBadge tone={oauthSourceTone(settings?.github.source ?? null)}>{settings ? oauthSourceLabel(settings.github.source, t) : t('settings.oauth.unknown')}</StatusBadge>
    </div>
  }>
    <OauthNotices settings={settings} />
    <div className="oauth-block">
      <div className="form-grid">
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientId')}</span>
          <Input value={github.clientId} aria-label={t('settings.oauth.clientId')} onChange={(event) => setGithub((current) => ({ ...current, clientId: event.target.value }))} placeholder="Iv1.0123456789abcdef" disabled={saving} />
          <a className="field-link" href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">{t('settings.oauth.createGithubApp')} <Plus size={12} /></a>
        </div>
        <div className="field">
          <span className="field-label">{t('settings.oauth.clientSecret')}</span>
          <Input.Password value={github.clientSecret} aria-label={t('settings.oauth.clientSecret')} onChange={(event) => setGithub((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={settings?.github.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={saving} />
        </div>
        <CopyField label={t('settings.oauth.redirectUri')} value={redirect} hint={t('settings.oauth.redirectHint')} />
        <TagListField label={t('settings.oauth.allowlist')} value={github.allowlist} onChange={(allowlist) => setGithub((current) => ({ ...current, allowlist }))} hint={t('settings.oauth.allowlistHint')} placeholder="octocat, admin@example.com" disabled={saving} />
      </div>
      <div className="settings-actions">
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={!settings}>{t('settings.oauth.save')}</Button>
        {settings?.github.source === 'database' && <Button onClick={() => void reset()} disabled={saving}>{t('settings.oauth.reset')}</Button>}
      </div>
    </div>
  </Panel>
}
