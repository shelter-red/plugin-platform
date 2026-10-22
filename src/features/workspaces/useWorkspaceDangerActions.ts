import { useState } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { deleteWorkspace, renameWorkspace, type Workspace } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

const DEFAULT_WORKSPACE_ID = 'ws_default'

export function useWorkspaceDangerActions({ active, onWorkspacesChange, onSwitch, onAction }: {
  active: Workspace
  onWorkspacesChange: () => Promise<void>
  onSwitch: (workspaceId: string) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'rename' | 'delete' | null>(null)
  const isDefault = active.id === DEFAULT_WORKSPACE_ID

  const rename = async () => {
    if (!name.trim()) {
      onAction('warning', t('workspace.nameRequired'))
      return
    }
    setBusy('rename')
    try {
      await renameWorkspace(active.id, name.trim())
      await onWorkspacesChange()
      setName('')
      onAction('success', t('workspace.renamed'))
    } catch (error) {
      onAction('error', errorMessage(error, 'workspace.renameFailed'))
    } finally {
      setBusy(null)
    }
  }

  const remove = () => {
    const workspace = active
    modalApi.confirm({
      title: t('workspace.delete'),
      content: t('workspace.deleteConfirm', { name: workspace.name }),
      okText: t('workspace.delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy('delete')
        try {
          await deleteWorkspace(workspace.id)
          await onWorkspacesChange()
          onSwitch(DEFAULT_WORKSPACE_ID)
          onAction('success', t('workspace.deleted'))
        } catch (error) {
          onAction('error', errorMessage(error, 'workspace.deleteFailed'))
        } finally {
          setBusy(null)
        }
      },
    })
  }

  return { name, setName, busy, isDefault, rename, remove }
}
