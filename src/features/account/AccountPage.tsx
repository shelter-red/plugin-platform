import type { Workspace } from '../../api'
import type { AccountUser } from './account'
import { AccountIdentityCard } from './AccountIdentityCard'
import { AccountLinksCard } from './AccountLinksCard'
import { AccountLogoutButton } from './AccountLogoutButton'
import { AccountWorkspacesCard } from './AccountWorkspacesCard'

export type { AccountUser } from './account'

export function AccountPage({ user, workspaces, activeWorkspaceId }: { user: AccountUser | null; workspaces: Workspace[]; activeWorkspaceId: string | null }) {
  return <div className="account-page">
    <AccountIdentityCard user={user} />
    <AccountWorkspacesCard workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} />
    <AccountLinksCard />
    <AccountLogoutButton />
  </div>
}
