import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Input } from 'antd'
import { Building2, Check, Trash2 } from 'lucide-react'
import { deleteWorkspace, renameWorkspace, type Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

const DEFAULT_WORKSPACE_ID = 'ws_default'

/** 改名与删除：默认工作区不可删除，删除后回到默认工作区由外层切换。 */
export function WorkspaceDangerPanel({ active, canManage, onWorkspacesChange, onSwitch, onAction }: {
  active: Workspace
  canManage: boolean
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

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Building2 size={18} /></div>
      <div><h2>{t('workspace.dangerTitle')}</h2><p>{isDefault ? t('workspace.defaultLocked') : t('workspace.dangerDescription')}</p></div>
    </div>
  }>
    <div className="form-grid">
      <label>{t('workspace.rename')}<Input value={name} onChange={(event) => setName(event.target.value)} placeholder={active.name} disabled={!canManage || busy !== null} /></label>
    </div>
    <div className="settings-actions quota-actions">
      <span className="form-hint">{canManage ? t('workspace.renameHint') : t('workspace.ownerOnly')}</span>
      <Button onClick={() => void rename()} loading={busy === 'rename'} disabled={!canManage || busy !== null || !name.trim()}>{t('workspace.rename')}<Check size={14} /></Button>
      <Button danger onClick={() => void remove()} loading={busy === 'delete'} disabled={!canManage || busy !== null || isDefault} title={isDefault ? t('workspace.defaultLocked') : undefined}>{t('workspace.delete')}<Trash2 size={14} /></Button>
    </div>
  </Panel>
}
