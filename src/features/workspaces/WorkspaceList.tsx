import { Button } from 'antd'
import { Building2, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../api'
import { workspaceRoleLabel } from './roles'

export function WorkspaceList({ workspaces, activeWorkspaceId, onSwitch }: { workspaces: Workspace[]; activeWorkspaceId: string | null; onSwitch: (workspaceId: string) => void }) {
  const { t } = useTranslation()
  return <div className="workspace-list">{workspaces.map((workspace) => <Button key={workspace.id} type="text" block className={`workspace-row ${workspace.id === activeWorkspaceId ? 'selected' : ''}`} onClick={() => onSwitch(workspace.id)} aria-pressed={workspace.id === activeWorkspaceId}><span className="workspace-row-name"><Building2 size={15} />{workspace.name}</span><span className="workspace-row-meta">{workspaceRoleLabel(t, workspace.role)}<small>{workspace.slug}</small></span>{workspace.id === activeWorkspaceId && <Check size={15} />}</Button>)}</div>
}
