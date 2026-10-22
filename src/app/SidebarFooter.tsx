import { Avatar, Button, Dropdown, type MenuProps } from 'antd'
import { ArrowUpRight, CircleHelp, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ApiMe } from '../api'

export function SidebarFooter({ user, userMenuItems, onUserMenu, onClose }: {
  user: ApiMe['user'] | null
  userMenuItems: MenuProps['items']
  onUserMenu: MenuProps['onClick']
  onClose: () => void
}) {
  const { t } = useTranslation()
  return <div className="sidebar-bottom">
    <Link className="support-link" to="/help" onClick={onClose}><CircleHelp size={15} /><span>{t('shell.help')}</span><ArrowUpRight size={12} /></Link>
    <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="topLeft">
      <Button type="text" block className="user-card">
        <Avatar size={26} className="avatar">{(user?.display_name ?? '—').slice(0, 2).toUpperCase()}</Avatar>
        <span className="user-copy"><strong>{user?.display_name ?? t('shell.unknownUser')}</strong><span>{user?.email ?? t('shell.unknownIdentity')}</span></span>
        <MoreHorizontal size={16} />
        <span className="sr-only">{t('shell.openUserMenu')}</span>
      </Button>
    </Dropdown>
  </div>
}
