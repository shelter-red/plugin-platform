import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 解释 Cloudflare 创建页中的名称、权限和资源范围，避免与 GitHub OAuth 配置混淆。 */
export function CloudflareTokenScopeGuide() {
  const { t } = useTranslation()
  return <div className="cloudflare-token-guide" data-testid="cloudflare-token-guide">
    <div className="cloudflare-token-guide-heading">
      <Info size={15} aria-hidden="true" />
      <strong>{t('settings.cloudflare.scopeGuideTitle')}</strong>
    </div>
    <ol>
      <li>{t('settings.cloudflare.scopeGuideName')}</li>
      <li>{t('settings.cloudflare.scopeGuidePermissions')}</li>
      <li>{t('settings.cloudflare.scopeGuideResources')}</li>
    </ol>
    <p>{t('settings.cloudflare.scopeGuideDomain')}</p>
  </div>
}
