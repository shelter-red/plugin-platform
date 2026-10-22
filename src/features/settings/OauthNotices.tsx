import { Alert } from 'antd'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OauthSettings } from '../../api'

/** 无法解密或缺少加密密钥时，两个 OAuth 区块都需要同一组提示。 */
export function OauthNotices({ settings }: { settings: OauthSettings | null }) {
  const { t } = useTranslation()
  return <>
    {settings?.unreadable && <Alert className="oauth-notice" type="warning" showIcon icon={<KeyRound size={16} />} message={t('settings.oauth.unreadable')} />}
    {settings && !settings.sessionSecretConfigured && <Alert className="oauth-notice" type="warning" showIcon icon={<KeyRound size={16} />} message={t('settings.oauth.sessionSecretMissing')} />}
  </>
}
