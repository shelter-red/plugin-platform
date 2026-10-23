import { useTranslation } from 'react-i18next'
import { Check, CircleHelp, X } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'

export const CLOUDFLARE_API_TOKEN_PERMISSIONS = [
  'Account Settings Read',
  'Account Analytics Read',
  'Billing Read',
  'Zone Read',
  'DNS Write',
  'Workers Routes Edit',
] as const

const PERMISSION_ROWS: Array<{
  key: (typeof CLOUDFLARE_API_TOKEN_PERMISSIONS)[number]
  scopeKey: string
  nameKey: string
  levelKey: string
  descriptionKey: string
}> = [
  { key: 'Account Settings Read', scopeKey: 'settings.cloudflare.permissionScopes.account', nameKey: 'settings.cloudflare.permissionNames.accountSettings', levelKey: 'settings.cloudflare.permissionLevels.read', descriptionKey: 'settings.cloudflare.permissions.accountSettings' },
  { key: 'Account Analytics Read', scopeKey: 'settings.cloudflare.permissionScopes.account', nameKey: 'settings.cloudflare.permissionNames.accountAnalytics', levelKey: 'settings.cloudflare.permissionLevels.read', descriptionKey: 'settings.cloudflare.permissions.accountAnalytics' },
  { key: 'Billing Read', scopeKey: 'settings.cloudflare.permissionScopes.account', nameKey: 'settings.cloudflare.permissionNames.billing', levelKey: 'settings.cloudflare.permissionLevels.read', descriptionKey: 'settings.cloudflare.permissions.billing' },
  { key: 'Zone Read', scopeKey: 'settings.cloudflare.permissionScopes.zone', nameKey: 'settings.cloudflare.permissionNames.zone', levelKey: 'settings.cloudflare.permissionLevels.read', descriptionKey: 'settings.cloudflare.permissions.zone' },
  { key: 'DNS Write', scopeKey: 'settings.cloudflare.permissionScopes.zone', nameKey: 'settings.cloudflare.permissionNames.dns', levelKey: 'settings.cloudflare.permissionLevels.write', descriptionKey: 'settings.cloudflare.permissions.dns' },
  { key: 'Workers Routes Edit', scopeKey: 'settings.cloudflare.permissionScopes.zone', nameKey: 'settings.cloudflare.permissionNames.routes', levelKey: 'settings.cloudflare.permissionLevels.edit', descriptionKey: 'settings.cloudflare.permissions.routes' },
]

/** Token 权限平铺展示；图标来自当前 Token 的实际 API 探测，不提供增删或自定义范围输入。 */
export function CloudflarePermissionList({ permissionStatus }: { permissionStatus?: Record<string, 'allowed' | 'denied' | 'unknown'> }) {
  const { t } = useTranslation()
  const stateIcon = (state: 'allowed' | 'denied' | 'unknown') => state === 'allowed' ? <Check size={14} aria-hidden="true" /> : state === 'denied' ? <X size={14} aria-hidden="true" /> : <CircleHelp size={14} aria-hidden="true" />
  return <div className="scope-permissions" id="settings-cloudflare-permissions" data-testid="cloudflare-permissions">
    <div className="scope-permissions-head">
      <span className="field-label">{t('settings.cloudflare.permissionsTitle')}</span>
      <StatusBadge tone="neutral">{t('settings.cloudflare.permissionsFixed')}</StatusBadge>
    </div>
    <p className="field-hint">{t('settings.cloudflare.permissionsHint')}</p>
    <div className="scope-list-head" aria-hidden="true">
      <span>{t('settings.cloudflare.permissionColumns.scope')}</span>
      <span>{t('settings.cloudflare.permissionColumns.name')}</span>
      <span>{t('settings.cloudflare.permissionColumns.level')}</span>
    </div>
    <ol className="scope-list">
      {PERMISSION_ROWS.map(({ key, scopeKey, nameKey, levelKey, descriptionKey }) => {
        const state = permissionStatus?.[key] ?? 'unknown'
        return <li key={key}>
          <span className="permission-scope">{t(scopeKey)}</span>
          <span className="permission-name"><strong>{t(nameKey)}</strong><small>{t(descriptionKey)}</small></span>
          <span className="permission-level"><span className="permission-tag">{t(levelKey)}</span><span className={`permission-state ${state === 'allowed' ? 'allowed' : state === 'denied' ? 'denied' : 'unknown'}`}>{stateIcon(state)}{t(`settings.cloudflare.permissionStates.${state}`)}</span></span>
        </li>
      })}
    </ol>
    <p className="field-hint">{t('settings.cloudflare.resourceScopeHint')}</p>
  </div>
}
