import { useTranslation } from 'react-i18next'
import { Switch } from 'antd'
import type { PlatformSettings } from '../../api'

export function MaintenanceToggle({ settings, maintenance, saving, onToggle }: {
  settings: PlatformSettings | null
  maintenance: boolean
  saving: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return <div className="maintenance-row">
    <div>
      <strong>{settings ? (maintenance ? t('settings.maintenance.pause') : t('settings.maintenance.allow')) : t('settings.maintenance.unknownTitle')}</strong>
      <span>{settings ? (maintenance ? t('settings.maintenance.pauseBody') : t('settings.maintenance.allowBody')) : t('settings.maintenance.unknownBody')}</span>
    </div>
    <Switch className="toggle" aria-label={t('settings.maintenance.title')} checked={Boolean(settings && !maintenance)} disabled={saving || !settings} loading={saving} onChange={onToggle} />
  </div>
}
