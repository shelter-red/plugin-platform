import { Menu, type MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Page } from './routes'
import { sidebarNavGroups } from './sidebar-nav'

export function SidebarNavigation({ compactNav, page, serverCount, onSelectPage }: {
  compactNav: boolean
  page: Page | null
  serverCount: number
  onSelectPage: (page: Page) => void
}) {
  const { t } = useTranslation()
  const navItems: MenuProps['items'] = sidebarNavGroups.map((group) => ({
    type: 'group',
    key: group.labelKey,
    label: t(group.labelKey),
    children: group.items.map(({ id, icon: NavIcon }) => ({
      key: id,
      icon: <NavIcon size={16} />,
      label: t(`nav.${id}`),
      extra: id === 'servers' && serverCount > 0 ? <span className="nav-count">{serverCount}</span> : undefined,
    })),
  }))
  return <nav className="nav-area" aria-label={t('shell.navigation')}>
    <Menu mode="inline" inlineCollapsed={compactNav} className="nav-menu" items={navItems} selectedKeys={page ? [page] : []} onClick={({ key }) => onSelectPage(key as Page)} />
  </nav>
}
