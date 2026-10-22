import { Button } from 'antd'
import { Check, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WorkspaceDangerActions({ canManage, busy, isDefault, canRename, onRename, onDelete }: {
  canManage: boolean
  busy: 'rename' | 'delete' | null
  isDefault: boolean
  canRename: boolean
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return <div className="settings-actions quota-actions">
    <span className="form-hint">{canManage ? t('workspace.renameHint') : t('workspace.ownerOnly')}</span>
    <Button onClick={onRename} loading={busy === 'rename'} disabled={!canManage || busy !== null || !canRename}>{t('workspace.rename')}<Check size={14} /></Button>
    <Button danger onClick={onDelete} loading={busy === 'delete'} disabled={!canManage || busy !== null || isDefault} title={isDefault ? t('workspace.defaultLocked') : undefined}>{t('workspace.delete')}<Trash2 size={14} /></Button>
  </div>
}
