import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from 'antd'
import { UserPlus } from 'lucide-react'
import type { WorkspaceRole } from '../../api'
import { MemberRoleSelect } from './MemberRoleSelect'

export function WorkspaceMemberForm({ canManage, busy, onAdd }: {
  canManage: boolean
  busy: boolean
  onAdd: (email: string, role: WorkspaceRole) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const disabled = !canManage || busy

  const submit = async () => {
    if (await onAdd(email.trim(), role)) setEmail('')
  }

  return <>
    <div className="form-grid">
      <label>{t('workspace.memberEmail')}<Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={disabled} /></label>
      <label>{t('workspace.role')}<MemberRoleSelect value={role} onChange={setRole} disabled={disabled} /></label>
    </div>
    <div className="settings-actions quota-actions">
      <span className="form-hint">{canManage ? t('workspace.addHint') : t('workspace.ownerOnly')}</span>
      <Button onClick={() => void submit()} loading={busy} disabled={disabled} title={canManage ? undefined : t('workspace.ownerOnly')}>{t('workspace.addMember')}<UserPlus size={14} /></Button>
    </div>
  </>
}
