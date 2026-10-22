import { Avatar } from 'antd'
import { Globe2, KeyRound, Mail, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Panel } from '../../components/Panel'
import type { AccountUser } from './account'

export function AccountIdentityCard({ user }: { user: AccountUser | null }) {
  const { t } = useTranslation()
  const role = user?.role === 'super_admin' ? t('account.roles.superAdmin') : user?.role === 'member' ? t('account.roles.member') : t('shell.unknownIdentity')
  const initials = (user?.display_name ?? user?.email ?? '—').trim().slice(0, 2).toUpperCase()
  return <Panel className="account-card" padded>
    <div className="account-identity">
      <Avatar className="avatar large" size={44}>{initials}</Avatar>
      <div><h2>{user?.display_name ?? t('shell.unknownUser')}</h2><p>{user?.email ?? t('shell.unknownIdentity')}</p></div>
    </div>
    <dl className="account-facts">
      <div><dt><UserRound size={14} />{t('account.name')}</dt><dd>{user?.display_name ?? t('common.notRead')}</dd></div>
      <div><dt><Mail size={14} />{t('account.email')}</dt><dd>{user?.email ?? t('common.notRead')}</dd></div>
      <div><dt><KeyRound size={14} />{t('account.role')}</dt><dd>{role}</dd></div>
      <div><dt><Globe2 size={14} />{t('account.provider')}</dt><dd>{t('account.githubProvider')}</dd></div>
    </dl>
  </Panel>
}
