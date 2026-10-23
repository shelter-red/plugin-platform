import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { StatusBadge } from '../../components/StatusBadge'

export const CLOUDFLARE_MONITOR_PERMISSIONS = [
  'Account Settings Read',
  'Account Analytics Read',
  'Billing Read',
] as const

export const CLOUDFLARE_DOMAIN_PERMISSIONS = [
  'Zone Read',
  'DNS Write',
  'Workers Routes Edit',
] as const

export const CLOUDFLARE_API_TOKEN_PERMISSIONS = [...CLOUDFLARE_MONITOR_PERMISSIONS, ...CLOUDFLARE_DOMAIN_PERMISSIONS] as const

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

function PermissionGroup({ title, names }: { title: string; names: readonly (typeof CLOUDFLARE_API_TOKEN_PERMISSIONS)[number][] }) {
  const { t } = useTranslation()
  return <section className="permission-group">
    <div className="permission-group-heading">
      <strong>{title}</strong>
      <span className="permission-tag">{t('settings.cloudflare.permissionRequired')}</span>
    </div>
    <ol className="scope-list">
      {names.map((name) => <li key={name}>
        <Check size={14} aria-hidden="true" />
        <div>
          <div className="permission-name"><strong>{name}</strong><span className="permission-tag">{t(MODE_KEYS[name])}</span></div>
          <span>{t(DESCRIPTION_KEYS[name])}</span>
        </div>
      </li>)}
    </ol>
  </section>
}

/** Token 权限由产品固定，只展示用途和操作类型；不提供增删、取消或自定义范围输入。 */
export function CloudflarePermissionList() {
  const { t } = useTranslation()
  return <div className="scope-permissions" id="settings-cloudflare-permissions" data-testid="cloudflare-permissions">
    <div className="scope-permissions-head">
      <span className="field-label">{t('settings.cloudflare.permissionsTitle')}</span>
      <StatusBadge tone="neutral">{t('settings.cloudflare.permissionsFixed')}</StatusBadge>
    </div>
    <p className="field-hint">{t('settings.cloudflare.permissionsHint')}</p>
    <PermissionGroup title={t('settings.cloudflare.monitorPermissionsTitle')} names={CLOUDFLARE_MONITOR_PERMISSIONS} />
    <PermissionGroup title={t('settings.cloudflare.domainPermissionsTitle')} names={CLOUDFLARE_DOMAIN_PERMISSIONS} />
    <p className="field-hint">{t('settings.cloudflare.permissionsApply')}</p>
  </div>
}
