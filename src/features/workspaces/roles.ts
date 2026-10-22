import type { TFunction } from 'i18next'
import type { WorkspaceRole } from '../../api'

/** 角色下拉与徽标共用同一份顺序，避免两处各写一遍后漂移。 */
export const workspaceRoles: WorkspaceRole[] = ['owner', 'operator', 'viewer']

export function workspaceRoleLabel(t: TFunction, role: WorkspaceRole): string {
  return t(`workspace.roles.${role}`)
}
