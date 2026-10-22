import { useState } from 'react'
import { Button, Input } from 'antd'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createWorkspace } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

export function WorkspaceCreateForm({ onSwitch, onWorkspacesChange, onAction }: {
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

  return <>
    <div className="form-grid">
      <label>{t('workspace.name')}<Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('workspace.namePlaceholder')} disabled={creating} /></label>
    </div>
    <div className="settings-actions quota-actions">
      <span className="form-hint">{t('workspace.roleHint')}</span>
      <Button type="primary" onClick={() => void create()} loading={creating} disabled={creating}>{t('workspace.create')}<Plus size={14} /></Button>
    </div>
  </>
}
