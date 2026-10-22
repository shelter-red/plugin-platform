import { useTranslation } from 'react-i18next'
import type { CloudflareOauthSettings } from '../../api'

/** OAuth 客户端的协议参数只读展示；PKCE 不属于 Cloudflare 客户端配置项。 */
export function CloudflareProtocolFields({ protocol }: { protocol: CloudflareOauthSettings | undefined }) {
  const { t } = useTranslation()
  return <>
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
  </>
}
