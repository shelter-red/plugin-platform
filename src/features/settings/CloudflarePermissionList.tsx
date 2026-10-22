import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'

export const CLOUDFLARE_API_TOKEN_PERMISSIONS = [
  'Account Settings Read',
  'Account Analytics Read',
  'Billing Read',
] as const

const DESCRIPTION_KEYS: Record<(typeof CLOUDFLARE_API_TOKEN_PERMISSIONS)[number], string> = {
  'Account Settings Read': 'settings.cloudflare.permissions.accountSettings',
  'Account Analytics Read': 'settings.cloudflare.permissions.accountAnalytics',
  'Billing Read': 'settings.cloudflare.permissions.billing',
}

/** 权限由产品固定，只展示三项；不提供增删、取消或 scope 输入。 */
export function CloudflarePermissionList({ permissions }: { permissions?: string[] }) {
  const { t } = useTranslation()
  const returned = new Set(permissions ?? [])
  return <div className="scope-permissions" id="settings-cloudflare-permissions" data-testid="cloudflare-permissions">
    <div className="scope-permissions-head">
      <span className="field-label">{t('settings.cloudflare.permissionsTitle')}</span>
      <StatusBadge tone="neutral">{t('settings.cloudflare.permissionsFixed')}</StatusBadge>
    </div>
    <p className="field-hint">{t('settings.cloudflare.permissionsHint')}</p>
    <ol className="scope-list">
      {CLOUDFLARE_API_TOKEN_PERMISSIONS.map((name) => <li key={name}>
        <Check size={14} aria-hidden="true" />
        <div>
          <strong>{name}</strong>
          <span>{t(DESCRIPTION_KEYS[name])}</span>
          {permissions !== undefined && !returned.has(name) && <span className="field-warning">{t('settings.cloudflare.permissionMissing')}</span>}
        </div>
      </li>)}
    </ol>
    <p className="field-hint">{t('settings.cloudflare.permissionsApply')}</p>
  </div>
}
