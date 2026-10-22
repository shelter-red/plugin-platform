import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from 'antd'
import { Building2, Check, Plus } from 'lucide-react'
import { createWorkspace, type Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'
import { workspaceRoleLabel } from './roles'

/** 工作区列表即导航；新建后由外层重取列表并切到新工作区，本组件不持有列表状态。 */
export function WorkspaceSwitcherPanel({ workspaces, activeWorkspaceId, onSwitch, onWorkspacesChange, onAction }: {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSwitch: (workspaceId: string) => void
  onWorkspacesChange: () => Promise<void>
  onAction: Notify
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (!name.trim()) {
      onAction('warning', t('workspace.nameRequired'))
      return
    }
    setCreating(true)
    try {
      const workspace = await createWorkspace(name.trim())
      await onWorkspacesChange()
      onSwitch(workspace.id)
      setName('')
      onAction('success', t('workspace.created'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Building2 size={18} /></div>
      <div><h2>{t('workspace.switcherTitle')}</h2><p>{t('workspace.switcherDescription')}</p></div>
      <StatusBadge tone="success">{t('workspace.count', { count: workspaces.length })}</StatusBadge>
    </div>
  }>
    <div className="workspace-list">{workspaces.map((workspace) => <Button key={workspace.id} type="text" block className={`workspace-row ${workspace.id === activeWorkspaceId ? 'selected' : ''}`} onClick={() => onSwitch(workspace.id)} aria-pressed={workspace.id === activeWorkspaceId}><span className="workspace-row-name"><Building2 size={15} />{workspace.name}</span><span className="workspace-row-meta">{workspaceRoleLabel(t, workspace.role)}<small>{workspace.slug}</small></span>{workspace.id === activeWorkspaceId && <Check size={15} />}</Button>)}</div>
    <div className="form-grid">
      <label>{t('workspace.name')}<Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.namePlaceholder')} disabled={creating} /></label>
    </div>
    <div className="settings-actions quota-actions">
      <span className="form-hint">{t('workspace.roleHint')}</span>
      <Button type="primary" onClick={() => void create()} loading={creating} disabled={creating}>{t('workspace.create')}<Plus size={14} /></Button>
    </div>
  </Panel>
}
