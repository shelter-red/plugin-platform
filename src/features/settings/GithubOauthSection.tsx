import { Button, Input } from 'antd'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OauthSettings } from '../../api'
import { CopyField } from '../../components/CopyField'
import { TagListField } from '../../components/TagListField'
import type { Notify } from '../../components/ToastProvider'
import { useGithubOauthForm } from './useGithubOauthForm'

/** GitHub OAuth 客户端凭据与白名单；回调地址只读，协议固定由后端决定。 */
export function GithubOauthSection({ settings, onChange, onAction }: {
  settings: OauthSettings | null
  onChange: (settings: OauthSettings) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const { github, patch, saving, redirect, save, reset } = useGithubOauthForm({ settings, onChange, onAction })

  return <div className="oauth-block">
    <div className="form-grid">
      <div className="field">
        <span className="field-label">{t('settings.oauth.clientId')}</span>
        <Input value={github.clientId} aria-label={t('settings.oauth.clientId')} onChange={(event) => patch('clientId', event.target.value)} placeholder="Iv1.0123456789abcdef" disabled={saving} />
        <a className="field-link" href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">{t('settings.oauth.createGithubApp')} <Plus size={12} /></a>
      </div>
      <div className="field">
        <span className="field-label">{t('settings.oauth.clientSecret')}</span>
        <Input.Password value={github.clientSecret} aria-label={t('settings.oauth.clientSecret')} onChange={(event) => patch('clientSecret', event.target.value)} placeholder={settings?.github.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={saving} />
      </div>
      <CopyField label={t('settings.oauth.redirectUri')} value={redirect} hint={t('settings.oauth.redirectHint')} />
      <TagListField label={t('settings.oauth.allowlist')} value={github.allowlist} onChange={(allowlist) => patch('allowlist', allowlist)} hint={t('settings.oauth.allowlistHint')} placeholder="octocat, admin@example.com" disabled={saving} />
    </div>
    <div className="settings-actions">
      <Button type="primary" onClick={() => void save()} loading={saving} disabled={!settings}>{t('settings.oauth.save')}</Button>
      {settings?.github.source === 'database' && <Button onClick={() => void reset()} disabled={saving}>{t('settings.oauth.reset')}</Button>}
    </div>
  </div>
}
