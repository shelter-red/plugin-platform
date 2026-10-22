import { Avatar, Button } from 'antd'
import { ArrowUpRight, Building2, Check, Globe2, KeyRound, LogOut, Mail, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'

export interface AccountUser {
  display_name: string
  email: string
  role?: string
}

export function AccountPage({ user, workspaces, activeWorkspaceId }: { user: AccountUser | null; workspaces: Workspace[]; activeWorkspaceId: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = user?.role === 'super_admin' ? t('account.roles.superAdmin') : user?.role === 'member' ? t('account.roles.member') : t('shell.unknownIdentity')
  const initials = (user?.display_name ?? user?.email ?? '—').trim().slice(0, 2).toUpperCase()
  return <div className="account-page">
    <Panel className="account-card" padded>
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
    <Panel className="account-card" padded>
      <div className="settings-heading">
        <div className="settings-icon"><Building2 size={18} /></div>
        <div><h2>{t('account.workspaces')}</h2><p>{t('account.workspacesHint')}</p></div>
        <StatusBadge tone="neutral">{t('workspace.count', { count: workspaces.length })}</StatusBadge>
      </div>
      {workspaces.length === 0
        ? <p className="form-hint">{t('account.noWorkspaces')}</p>
        : <div className="workspace-list">{workspaces.map((workspace) => <Link key={workspace.id} className={`workspace-row ${workspace.id === activeWorkspaceId ? 'selected' : ''}`} to="/workspaces"><span className="workspace-row-name"><Building2 size={15} />{workspace.name}</span><span className="workspace-row-meta">{t(`workspace.roles.${workspace.role}`)}<small>{workspace.slug}</small></span>{workspace.id === activeWorkspaceId && <Check size={15} />}</Link>)}</div>}
      <div className="settings-actions quota-actions">
        <span className="form-hint">{t('account.workspacesLinkHint')}</span>
        <Button onClick={() => navigate('/workspaces')}>{t('workspace.manage')}<ArrowUpRight size={14} /></Button>
      </div>
    </Panel>
    <Panel className="account-links" padded>
      <h2>{t('account.more')}</h2>
      <Link to="/help">{t('docs.help.title')}<ArrowUpRight size={14} /></Link>
      <Link to="/terms">{t('docs.terms.title')}<ArrowUpRight size={14} /></Link>
      <Link to="/privacy">{t('docs.privacy.title')}<ArrowUpRight size={14} /></Link>
    </Panel>
    <Button className="account-logout" onClick={() => window.location.assign('/auth/logout')} icon={<LogOut size={15} />}>{t('account.logout')}</Button>
  </div>
}
