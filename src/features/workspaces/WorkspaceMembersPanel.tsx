import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Input, Select, Skeleton, Table, type TableProps } from 'antd'
import { Building2, Trash2, UserPlus, Users } from 'lucide-react'
import {
  addWorkspaceMember,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMember,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'
import { workspaceRoleLabel, workspaceRoles } from './roles'

/** 成员面板自带加载与逐行 busy 状态；切换工作区时按 id 重新拉取成员。 */
export function WorkspaceMembersPanel({ active, canManage, onAction }: {
  active: Workspace | null
  canManage: boolean
  onAction: Notify
}) {
  const { t } = useTranslation()
  // 危险操作统一走 AntD Modal.confirm，避免原生 window.confirm 破坏主题与键盘可达性。
  const modalApi = App.useApp().modal
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) {
      setMembers(null)
      return
    }
    let cancelled = false
    setMembers(null)
    setError(null)
    fetchWorkspaceMembers(active.id)
      .then((value) => { if (!cancelled) setMembers(value) })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason, 'workspace.membersFailed')) })
    return () => { cancelled = true }
  }, [active?.id, active?.role])

  const reload = async (workspaceId: string) => setMembers(await fetchWorkspaceMembers(workspaceId))

  const addMember = async () => {
    if (!active) return
    if (!email.trim()) {
      onAction('warning', t('workspace.memberEmailRequired'))
      return
    }
    setBusy('add')
    try {
      await addWorkspaceMember(active.id, { email: email.trim(), role })
      await reload(active.id)
      setEmail('')
      onAction('success', t('workspace.memberAdded'))
    } catch (reason) {
      onAction('error', errorMessage(reason, 'workspace.addFailed'))
    } finally {
      setBusy(null)
    }
  }

  const changeRole = async (member: WorkspaceMember, nextRole: WorkspaceRole) => {
    if (!active) return
    setBusy(`role-${member.user_id}`)
    try {
      await updateWorkspaceMember(active.id, member.user_id, nextRole)
      await reload(active.id)
      onAction('success', t('workspace.memberUpdated'))
    } catch (reason) {
      onAction('error', errorMessage(reason, 'workspace.updateFailed'))
    } finally {
      setBusy(null)
    }
  }

  const removeMember = (member: WorkspaceMember) => {
    if (!active) return
    const workspaceId = active.id
    modalApi.confirm({
      title: t('workspace.remove'),
      content: t('workspace.removeConfirm', { name: member.display_name || member.email }),
      okText: t('workspace.remove'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(`remove-${member.user_id}`)
        try {
          await removeWorkspaceMember(workspaceId, member.user_id)
          await reload(workspaceId)
          onAction('success', t('workspace.memberRemoved'))
        } catch (reason) {
          onAction('error', errorMessage(reason, 'workspace.removeFailed'))
        } finally {
          setBusy(null)
        }
      },
    })
  }

  const locked = !canManage || busy !== null
  const columns: TableProps<WorkspaceMember>['columns'] = [
    {
      title: t('workspace.member'),
      dataIndex: 'email',
      render: (_, member) => <div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{member.display_name || member.email}</strong><small>{member.email || member.github_id}</small></div></div>,
    },
    {
      title: t('workspace.role'),
      key: 'role',
      render: (_, member) => <Select aria-label={t('workspace.role')} value={member.role} onChange={(value: WorkspaceRole) => void changeRole(member, value)} disabled={locked} options={workspaceRoles.map((item) => ({ value: item, label: workspaceRoleLabel(t, item) }))} />,
    },
    { title: t('workspace.joinedAt'), dataIndex: 'created_at', render: (value: string) => new Date(value).toLocaleString() },
    {
      title: '',
      key: 'actions',
      width: 64,
      render: (_, member) => canManage ? <Button type="text" size="small" onClick={() => void removeMember(member)} disabled={busy !== null} aria-label={t('workspace.remove')} title={t('workspace.remove')} icon={<Trash2 size={15} />} /> : null,
    },
  ]

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Users size={18} /></div>
      <div><h2>{t('workspace.membersTitle')}</h2><p>{active ? t('workspace.membersDescription', { name: active.name }) : t('workspace.none')}</p></div>
      <StatusBadge tone={canManage ? 'success' : 'warning'}>{active ? workspaceRoleLabel(t, active.role) : t('workspace.none')}</StatusBadge>
    </div>
  }>
    {!active ? <EmptyState icon={<Building2 size={20} />} title={t('workspace.none')} body={t('workspace.noneHint')} /> : <>
      <div className="form-grid">
        <label>{t('workspace.memberEmail')}<Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={locked} /></label>
        <label>{t('workspace.role')}<Select value={role} onChange={(value: WorkspaceRole) => setRole(value)} disabled={locked} options={workspaceRoles.map((item) => ({ value: item, label: workspaceRoleLabel(t, item) }))} /></label>
      </div>
      <div className="settings-actions quota-actions">
        <span className="form-hint">{canManage ? t('workspace.addHint') : t('workspace.ownerOnly')}</span>
        <Button onClick={() => void addMember()} loading={busy === 'add'} disabled={locked} title={canManage ? undefined : t('workspace.ownerOnly')}>{t('workspace.addMember')}<UserPlus size={14} /></Button>
      </div>
      {error && <div className="form-hint error">{error}</div>}
      {members === null ? <Skeleton active paragraph={{ rows: 3 }} /> : members.length === 0 ? <EmptyState icon={<Users size={20} />} title={t('workspace.noMembers')} body={t('workspace.noMembersHint')} /> : <Table<WorkspaceMember> rowKey="user_id" size="small" columns={columns} dataSource={members} pagination={false} scroll={{ x: 560 }} />}
    </>}
  </Panel>
}
