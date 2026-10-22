import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import {
  addWorkspaceMember,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMember,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

/** 成员数据、逐行 busy 状态和工作区切换后的重新加载；删除确认也在此统一处理。 */
export function useWorkspaceMembers(active: Workspace | null, onAction: Notify) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null)
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

  const addMember = async (email: string, role: WorkspaceRole): Promise<boolean> => {
    if (!active) return false
    if (!email) {
      onAction('warning', t('workspace.memberEmailRequired'))
      return false
    }
    setBusy('add')
    try {
      await addWorkspaceMember(active.id, { email, role })
      await reload(active.id)
      onAction('success', t('workspace.memberAdded'))
      return true
    } catch (reason) {
      onAction('error', errorMessage(reason, 'workspace.addFailed'))
      return false
    } finally {
      setBusy(null)
    }
  }

  const changeRole = async (member: WorkspaceMember, role: WorkspaceRole) => {
    if (!active) return
    setBusy(`role-${member.user_id}`)
    try {
      await updateWorkspaceMember(active.id, member.user_id, role)
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

  return { members, busy, error, addMember, changeRole, removeMember }
}
