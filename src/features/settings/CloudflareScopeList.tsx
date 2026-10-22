import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'
import { CLOUDFLARE_SCOPE_FALLBACK } from './cloudflare-auth'

/** 权限说明按 Scope ID 映射到 i18n；Worker 只返回官方名称，说明固定在界面里。 */
const PERMISSION_DESCRIPTION_KEYS: Record<string, string> = {
  'account-settings.read': 'settings.cloudflare.permissions.accountSettings',
  'account-analytics.read': 'settings.cloudflare.permissions.accountAnalytics',
}

export function CloudflareScopeList({ scopes }: { scopes?: Record<string, string> }) {
  const { t } = useTranslation()
  return <div className="scope-permissions" id="settings-cloudflare-scopes" data-testid="cloudflare-scopes">
    <div className="scope-permissions-head">
      <span className="field-label">{t('settings.cloudflare.permissionsTitle')}</span>
      <StatusBadge tone="neutral">{t('settings.cloudflare.permissionsFixed')}</StatusBadge>
    </div>
    <p className="field-hint">{t('settings.cloudflare.permissionsHint')}</p>
    <ol className="scope-list">
      {Object.entries(scopes ?? CLOUDFLARE_SCOPE_FALLBACK).map(([id, name]) => <li key={id}>
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
}
