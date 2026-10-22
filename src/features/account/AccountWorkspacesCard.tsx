import { Button } from 'antd'
import { ArrowUpRight, Building2, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import type { Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'

export function AccountWorkspacesCard({ workspaces, activeWorkspaceId }: { workspaces: Workspace[]; activeWorkspaceId: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return <Panel className="account-card" padded>
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
}
