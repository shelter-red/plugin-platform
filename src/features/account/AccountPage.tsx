import { ArrowUpRight, Globe2, KeyRound, LogOut, Mail, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export interface AccountUser {
  display_name: string
  email: string
  role?: string
}

export function AccountPage({ user }: { user: AccountUser | null }) {
  const { t } = useTranslation()
  const role = user?.role === 'super_admin' ? t('account.roles.superAdmin') : user?.role === 'member' ? t('account.roles.member') : t('shell.unknownIdentity')
  return <div className="account-page">
    <section className="panel account-card">
      <div className="account-identity">
        <div className="avatar large">{(user?.display_name ?? user?.email ?? '—').trim().slice(0, 2).toUpperCase()}</div>
        <div><h2>{user?.display_name ?? t('shell.unknownUser')}</h2><p>{user?.email ?? t('shell.unknownIdentity')}</p></div>
      </div>
      <dl className="account-facts">
        <div><dt><UserRound size={14} />{t('account.name')}</dt><dd>{user?.display_name ?? t('common.notRead')}</dd></div>
        <div><dt><Mail size={14} />{t('account.email')}</dt><dd>{user?.email ?? t('common.notRead')}</dd></div>
        <div><dt><KeyRound size={14} />{t('account.role')}</dt><dd>{role}</dd></div>
        <div><dt><Globe2 size={14} />{t('account.provider')}</dt><dd>{t('account.githubProvider')}</dd></div>
      </dl>
    </section>
    <section className="panel account-links">
      <h2>{t('account.more')}</h2>
      <Link to="/help">{t('docs.help.title')}<ArrowUpRight size={14} /></Link>
      <Link to="/terms">{t('docs.terms.title')}<ArrowUpRight size={14} /></Link>
      <Link to="/privacy">{t('docs.privacy.title')}<ArrowUpRight size={14} /></Link>
    </section>
    <button className="button secondary account-logout" onClick={() => window.location.assign('/auth/logout')}><LogOut size={15} />{t('account.logout')}</button>
  </div>
}
