import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from 'antd'
import { Building2, Check, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import {
  addWorkspaceMember,
  createWorkspace,
  deleteWorkspace,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  renameWorkspace,
  updateWorkspaceMember,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

const roleOptions: WorkspaceRole[] = ['owner', 'operator', 'viewer']
const DEFAULT_WORKSPACE_ID = 'ws_default'

export function WorkspacePage({ workspaces, activeWorkspaceId, onSwitch, onWorkspacesChange, onAction }: {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSwitch: (workspaceId: string) => void
  onWorkspacesChange: () => Promise<void>
  onAction: Notify
}) {
  const { t } = useTranslation()
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const canManage = active?.role === 'owner'
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newName, setNewName] = useState('')
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<WorkspaceRole>('viewer')
  const [busy, setBusy] = useState<string | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)

  const roleLabel = (role: WorkspaceRole) => t(`workspace.roles.${role}`)

  useEffect(() => {
    if (!active) {
      setMembers(null)
      return
    }
    let cancelled = false
    setMembers(null)
    setMembersError(null)
    fetchWorkspaceMembers(active.id)
      .then((value) => { if (!cancelled) setMembers(value) })
      .catch((error) => { if (!cancelled) setMembersError(errorMessage(error, 'workspace.membersFailed')) })
    return () => { cancelled = true }
  }, [active?.id, active?.role])

  const create = async () => {
    if (!newWorkspaceName.trim()) {
      onAction('warning', t('workspace.nameRequired'))
      return
    }
    setBusy('create')
    try {
      const workspace = await createWorkspace(newWorkspaceName.trim())
      await onWorkspacesChange()
      onSwitch(workspace.id)
      setNewWorkspaceName('')
      onAction('success', t('workspace.created'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.createFailed'))
    } finally {
      setBusy(null)
    }
  }

  const rename = async () => {
    if (!active) return
    if (!newName.trim()) {
      onAction('warning', t('workspace.nameRequired'))
      return
    }
    setBusy('rename')
    try {
      await renameWorkspace(active.id, newName.trim())
      await onWorkspacesChange()
      setNewName('')
      onAction('success', t('workspace.renamed'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.renameFailed'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!active) return
    if (!window.confirm(t('workspace.deleteConfirm', { name: active.name }))) return
    setBusy('delete')
    try {
      await deleteWorkspace(active.id)
      await onWorkspacesChange()
      onSwitch(DEFAULT_WORKSPACE_ID)
      onAction('success', t('workspace.deleted'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.deleteFailed'))
    } finally {
      setBusy(null)
    }
  }

  const addMember = async () => {
    if (!active) return
    if (!memberEmail.trim()) {
      onAction('warning', t('workspace.memberEmailRequired'))
      return
    }
    setBusy('add-member')
    try {
      await addWorkspaceMember(active.id, { email: memberEmail.trim(), role: memberRole })
      setMembers(await fetchWorkspaceMembers(active.id))
      setMemberEmail('')
      onAction('success', t('workspace.memberAdded'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.addFailed'))
    } finally {
      setBusy(null)
    }
  }

  const changeRole = async (member: WorkspaceMember, role: WorkspaceRole) => {
    if (!active) return
    setBusy(`role-${member.user_id}`)
    try {
      await updateWorkspaceMember(active.id, member.user_id, role)
      setMembers(await fetchWorkspaceMembers(active.id))
      onAction('success', t('workspace.memberUpdated'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.updateFailed'))
    } finally {
      setBusy(null)
    }
  }

  const removeMember = async (member: WorkspaceMember) => {
    if (!active) return
    if (!window.confirm(t('workspace.removeConfirm', { name: member.display_name || member.email }))) return
    setBusy(`remove-${member.user_id}`)
    try {
      await removeWorkspaceMember(active.id, member.user_id)
      setMembers(await fetchWorkspaceMembers(active.id))
      onAction('success', t('workspace.memberRemoved'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.removeFailed'))
    } finally {
      setBusy(null)
    }
  }

  return <div className="workspace-page">
    <section className="panel settings-panel">
      <div className="settings-heading">
        <div className="settings-icon"><Building2 size={18} /></div>
        <div><h2>{t('workspace.switcherTitle')}</h2><p>{t('workspace.switcherDescription')}</p></div>
        <StatusBadge tone="success">{t('workspace.count', { count: workspaces.length })}</StatusBadge>
      </div>
      <div className="workspace-list">{workspaces.map((workspace) => <button key={workspace.id} type="button" className={`workspace-row ${workspace.id === activeWorkspaceId ? 'selected' : ''}`} onClick={() => onSwitch(workspace.id)} aria-pressed={workspace.id === activeWorkspaceId}><span className="workspace-row-name"><Building2 size={15} />{workspace.name}</span><span className="workspace-row-meta">{roleLabel(workspace.role)}<small>{workspace.slug}</small></span>{workspace.id === activeWorkspaceId && <Check size={15} />}</button>)}</div>
      <div className="form-grid">
        <label>{t('workspace.name')}<input value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder={t('workspace.namePlaceholder')} disabled={busy !== null} /></label>
      </div>
      <div className="settings-actions quota-actions">
        <span className="form-hint">{t('workspace.roleHint')}</span>
        <button className="button primary" onClick={() => void create()} disabled={busy !== null}>{busy === 'create' ? t('common.saving') : t('workspace.create')}<Plus size={14} /></button>
      </div>
    </section>

    <section className="panel settings-panel">
      <div className="settings-heading">
        <div className="settings-icon"><Users size={18} /></div>
        <div><h2>{t('workspace.membersTitle')}</h2><p>{active ? t('workspace.membersDescription', { name: active.name }) : t('workspace.none')}</p></div>
        <StatusBadge tone={canManage ? 'success' : 'warning'}>{active ? roleLabel(active.role) : t('workspace.none')}</StatusBadge>
      </div>
      {!active ? <div className="empty-panel"><div className="empty-illustration"><Building2 size={20} /></div><h3>{t('workspace.none')}</h3><p>{t('workspace.noneHint')}</p></div> : <>
        <div className="form-grid">
          <label>{t('workspace.memberEmail')}<input value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="member@example.com" disabled={!canManage || busy !== null} /></label>
          <label>{t('workspace.role')}<Select value={memberRole} onChange={(value: WorkspaceRole) => setMemberRole(value)} disabled={!canManage || busy !== null} options={roleOptions.map((role) => ({ value: role, label: roleLabel(role) }))} /></label>
        </div>
        <div className="settings-actions quota-actions">
          <span className="form-hint">{canManage ? t('workspace.addHint') : t('workspace.ownerOnly')}</span>
          <button className="button secondary" onClick={() => void addMember()} disabled={!canManage || busy !== null} title={canManage ? undefined : t('workspace.ownerOnly')}>{t('workspace.addMember')}<UserPlus size={14} /></button>
        </div>
        {membersError && <div className="form-hint error">{membersError}</div>}
        {members === null ? <div className="empty-panel"><div className="loading-line" /></div> : members.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>{t('workspace.noMembers')}</h3><p>{t('workspace.noMembersHint')}</p></div> : <div className="table-wrap"><table><thead><tr><th>{t('workspace.member')}</th><th>{t('workspace.role')}</th><th>{t('workspace.joinedAt')}</th><th /></tr></thead><tbody>{members.map((member) => <tr key={member.user_id}><td><div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{member.display_name || member.email}</strong><small>{member.email || member.github_id}</small></div></div></td><td><Select aria-label={t('workspace.role')} value={member.role} onChange={(value: WorkspaceRole) => void changeRole(member, value)} disabled={!canManage || busy !== null} options={roleOptions.map((role) => ({ value: role, label: roleLabel(role) }))} /></td><td>{new Date(member.created_at).toLocaleString()}</td><td>{canManage && <button type="button" className="row-action" onClick={() => void removeMember(member)} disabled={busy !== null} aria-label={t('workspace.remove')} title={t('workspace.remove')}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div>}
      </>}
    </section>

    {active && <section className="panel settings-panel">
      <div className="settings-heading">
        <div className="settings-icon"><Building2 size={18} /></div>
        <div><h2>{t('workspace.dangerTitle')}</h2><p>{active.id === DEFAULT_WORKSPACE_ID ? t('workspace.defaultLocked') : t('workspace.dangerDescription')}</p></div>
      </div>
      <div className="form-grid">
        <label>{t('workspace.rename')}<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={active.name} disabled={!canManage || busy !== null} /></label>
      </div>
      <div className="settings-actions quota-actions">
        <span className="form-hint">{canManage ? t('workspace.renameHint') : t('workspace.ownerOnly')}</span>
        <button className="button secondary" onClick={() => void rename()} disabled={!canManage || busy !== null || !newName.trim()}>{busy === 'rename' ? t('common.saving') : t('workspace.rename')}<Check size={14} /></button>
        <button className="button danger" onClick={() => void remove()} disabled={!canManage || busy !== null || active.id === DEFAULT_WORKSPACE_ID} title={active.id === DEFAULT_WORKSPACE_ID ? t('workspace.defaultLocked') : undefined}>{t('workspace.delete')}<Trash2 size={14} /></button>
      </div>
    </section>}
  </div>
}
