import { useTranslation } from 'react-i18next'
import { Select } from 'antd'
import type { WorkspaceRole } from '../../api'
import { workspaceRoleLabel, workspaceRoles } from './roles'

export function MemberRoleSelect({ value, disabled, onChange }: {
  value: WorkspaceRole
  disabled: boolean
  onChange: (role: WorkspaceRole) => void
}) {
  const { t } = useTranslation()
  return <Select
    aria-label={t('workspace.role')}
    value={value}
    onChange={onChange}
    disabled={disabled}
    options={workspaceRoles.map((role) => ({ value: role, label: workspaceRoleLabel(t, role) }))}
  />
}
