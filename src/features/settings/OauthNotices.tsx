import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OauthSettings } from '../../api'

/** 无法解密或缺少加密密钥时，两个 OAuth 区块都需要同一组提示。 */
export function OauthNotices({ settings }: { settings: OauthSettings | null }) {
  const { t } = useTranslation()
  return <>
    {settings?.unreadable && <div className="notice-bar compact oauth-notice"><div className="notice-icon"><KeyRound size={16} /></div><div><strong>{t('settings.oauth.unreadable')}</strong></div></div>}
    {settings && !settings.sessionSecretConfigured && <div className="notice-bar compact oauth-notice"><div className="notice-icon"><KeyRound size={16} /></div><div><strong>{t('settings.oauth.sessionSecretMissing')}</strong></div></div>}
  </>
}
