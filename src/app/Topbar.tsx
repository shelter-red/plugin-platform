import { useTranslation } from 'react-i18next'
import { Button, Dropdown, Select, type MenuProps } from 'antd'
import { Activity, Command, Globe2, Menu as MenuIcon, Search, Sun } from 'lucide-react'
import { IconButton } from '../components/IconButton'
import type { ThemePreference } from './theme'
import type { Language } from '../i18n'

export type TopbarProps = {
  title: string
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  language: Language
  onLanguageChange: (language: Language) => void
  userInitials: string
  userMenuItems: MenuProps['items']
  onUserMenu: MenuProps['onClick']
  onOpenPalette: () => void
  onOpenNav: () => void
  onOpenAudit: () => void
}

/** 顶栏：面包屑、命令面板入口、主题与语言切换、审计快捷与头像菜单。 */
export function Topbar({ title, theme, onThemeChange, language, onLanguageChange, userInitials, userMenuItems, onUserMenu, onOpenPalette, onOpenNav, onOpenAudit }: TopbarProps) {
  const { t } = useTranslation()
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <IconButton label={t('shell.openNav')} onClick={onOpenNav}><MenuIcon size={18} /></IconButton>
        <div className="breadcrumbs"><span>{t('shell.console')}</span><span>/</span><strong>{title}</strong></div>
      </div>
      <div className="topbar-actions">
        <Button type="text" className="search-box" onClick={onOpenPalette} icon={<Search size={15} />}><span className="search-label">{t('shell.search')}</span><span className="shortcut"><Command size={11} /> K</span><span className="sr-only">{t('palette.title')}</span></Button>
        <div className="theme-menu"><Sun size={16} aria-hidden="true" /><Select aria-label={t('theme.select')} value={theme} onChange={onThemeChange} variant="borderless" popupMatchSelectWidth={false} options={[{ value: 'dark', label: t('theme.dark') }, { value: 'light', label: t('theme.light') }, { value: 'system', label: t('theme.system') }]} /></div>
        <div className="theme-menu language-menu"><Globe2 size={16} aria-hidden="true" /><Select aria-label={t('language.select')} value={language} onChange={onLanguageChange} variant="borderless" popupMatchSelectWidth={false} options={[{ value: 'zh-CN', label: t('language.zh') }, { value: 'en', label: t('language.en') }]} /></div>
        <IconButton label={t('shell.auditEvents')} onClick={onOpenAudit}><Activity size={16} /></IconButton>
        <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="bottomRight">
          <Button type="text" shape="circle" className="top-avatar" aria-label={t('shell.currentUser')}>{userInitials}</Button>
        </Dropdown>
      </div>
    </header>
  )
}
