import { Menu } from 'antd'
import { Cloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 设置页左侧分区导航：纯展示，滚动联动由 useSettingsSections 提供。 */
export function SettingsNav({ items, activeSection, onSelect }: {
  items: { id: string; label: string; icon: typeof Cloud }[]
  activeSection: string
  onSelect: (section: string) => void
}) {
  const { t } = useTranslation()
  return <nav className="settings-nav" aria-label={t('pages.settings.title')}>
    <Menu mode="inline" className="settings-menu" items={items.map(({ id, label, icon: Icon }) => ({ key: id, icon: <Icon size={15} />, label }))} selectedKeys={[activeSection]} onClick={({ key }) => onSelect(key)} />
  </nav>
}
