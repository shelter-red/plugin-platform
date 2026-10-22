import { LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OauthSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { GithubOauthSection } from './GithubOauthSection'
import { oauthSourceLabel, oauthSourceTone } from './oauth-source'
import { OauthNotices } from './OauthNotices'

/** GitHub OAuth 面板：标题徽标 + 共享提示 + 客户端配置区。 */
export function OauthPanel({ settings, onChange, onAction }: { settings: OauthSettings | null; onChange: (settings: OauthSettings) => void; onAction: Notify }) {
  const { t } = useTranslation()
  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><LogIn size={18} /></div>
      <div><h2>{t('settings.oauth.githubTitle')}</h2><p>{t('settings.oauth.githubDescription')}</p></div>
      <StatusBadge tone={oauthSourceTone(settings?.github.source ?? null)}>{settings ? oauthSourceLabel(settings.github.source, t) : t('settings.oauth.unknown')}</StatusBadge>
    </div>
  }>
    <OauthNotices settings={settings} />
    <GithubOauthSection settings={settings} onChange={onChange} onAction={onAction} />
  </Panel>
}
