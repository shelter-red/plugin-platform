import { useTranslation } from 'react-i18next'
import { Button, Table, type TableProps } from 'antd'
import { Trash2, Users } from 'lucide-react'
import type { WorkspaceMember, WorkspaceRole } from '../../api'
import { MemberRoleSelect } from './MemberRoleSelect'

export function WorkspaceMemberTable({ members, canManage, busy, onChangeRole, onRemove }: {
  members: WorkspaceMember[]
  canManage: boolean
  busy: boolean
  onChangeRole: (member: WorkspaceMember, role: WorkspaceRole) => void
  onRemove: (member: WorkspaceMember) => void
}) {
  const { t } = useTranslation()
  const columns: TableProps<WorkspaceMember>['columns'] = [
    {
      title: t('workspace.member'),
      dataIndex: 'email',
      render: (_, member) => <div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{member.display_name || member.email}</strong><small>{member.email}</small></div></div>,
    },
    {
      title: t('workspace.role'),
      key: 'role',
      render: (_, member) => <MemberRoleSelect value={member.role} onChange={(role) => onChangeRole(member, role)} disabled={!canManage || busy} />,
    },
    { title: t('workspace.joinedAt'), dataIndex: 'created_at', render: (value: string) => new Date(value).toLocaleString() },
    {
      title: '',
      key: 'actions',
      width: 64,
      render: (_, member) => canManage ? <Button type="text" size="small" onClick={() => onRemove(member)} disabled={busy} aria-label={t('workspace.remove')} title={t('workspace.remove')} icon={<Trash2 size={15} />} /> : null,
    },
  ]

  return <Table<WorkspaceMember> rowKey="user_id" size="small" columns={columns} dataSource={members} pagination={false} scroll={{ x: 560 }} />
}
