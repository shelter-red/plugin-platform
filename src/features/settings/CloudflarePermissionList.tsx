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

const DESCRIPTION_KEYS: Record<(typeof CLOUDFLARE_API_TOKEN_PERMISSIONS)[number], string> = {
  'Account Settings Read': 'settings.cloudflare.permissions.accountSettings',
  'Account Analytics Read': 'settings.cloudflare.permissions.accountAnalytics',
  'Billing Read': 'settings.cloudflare.permissions.billing',
  'Zone Read': 'settings.cloudflare.permissions.zone',
  'DNS Write': 'settings.cloudflare.permissions.dns',
  'Workers Routes Edit': 'settings.cloudflare.permissions.routes',
}

const MODE_KEYS: Record<(typeof CLOUDFLARE_API_TOKEN_PERMISSIONS)[number], string> = {
  'Account Settings Read': 'settings.cloudflare.permissionModes.readOnly',
  'Account Analytics Read': 'settings.cloudflare.permissionModes.readOnly',
  'Billing Read': 'settings.cloudflare.permissionModes.readOnly',
  'Zone Read': 'settings.cloudflare.permissionModes.readOnly',
  'DNS Write': 'settings.cloudflare.permissionModes.write',
  'Workers Routes Edit': 'settings.cloudflare.permissionModes.edit',
}

const RESOURCE_SCOPE_KEYS: Record<(typeof CLOUDFLARE_API_TOKEN_PERMISSIONS)[number], string> = {
  'Account Settings Read': 'settings.cloudflare.permissionScopes.account',
  'Account Analytics Read': 'settings.cloudflare.permissionScopes.account',
  'Billing Read': 'settings.cloudflare.permissionScopes.account',
  'Zone Read': 'settings.cloudflare.permissionScopes.zone',
  'DNS Write': 'settings.cloudflare.permissionScopes.zone',
  'Workers Routes Edit': 'settings.cloudflare.permissionScopes.zone',
}

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
    <ol className="scope-list">
      {CLOUDFLARE_API_TOKEN_PERMISSIONS.map((name) => {
        const state = permissionStatus?.[name] ?? 'unknown'
        return <li key={name}>
          <span className={`permission-state ${state === 'allowed' ? 'allowed' : state === 'denied' ? 'denied' : 'unknown'}`}>{stateIcon(state)}</span>
          <div>
            <div className="permission-name"><strong>{name}</strong><span className="permission-scope">{t(RESOURCE_SCOPE_KEYS[name])}</span><span className="permission-tag">{t(MODE_KEYS[name])}</span><span className={`permission-state ${state === 'allowed' ? 'allowed' : state === 'denied' ? 'denied' : 'unknown'}`}>{t(`settings.cloudflare.permissionStates.${state}`)}</span></div>
            <span>{t(DESCRIPTION_KEYS[name])}</span>
          </div>
        </li>
      })}
    </ol>
    <p className="field-hint">{t('settings.cloudflare.resourceScopeHint')}</p>
  </div>
}
