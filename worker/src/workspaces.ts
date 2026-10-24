import { getCookie } from './cookies'
import type { AuthenticatedUser, Env, Workspace, WorkspaceMember, WorkspaceRole } from './types'

export const DEFAULT_WORKSPACE_ID = 'ws_default'
export const WORKSPACE_COOKIE = 'plugmesh_workspace'

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export type WorkspaceContext = { workspace: Workspace }

export async function listWorkspaces(env: Env, user: AuthenticatedUser): Promise<Workspace[]> {
  if (user.role === 'super_admin') {
    return (await env.DB.prepare(`
      SELECT workspaces.id, workspaces.name, workspaces.slug, workspaces.created_at, workspaces.updated_at,
        COALESCE(workspace_members.role, 'owner') AS role
      FROM workspaces
      LEFT JOIN workspace_members ON workspace_members.workspace_id = workspaces.id AND workspace_members.user_id = ?
      ORDER BY workspaces.created_at ASC, workspaces.id ASC
    `).bind(user.id).all<Workspace>()).results
  }
  return (await env.DB.prepare(`
    SELECT workspaces.id, workspaces.name, workspaces.slug, workspaces.created_at, workspaces.updated_at, workspace_members.role
    FROM workspace_members
    JOIN workspaces ON workspaces.id = workspace_members.workspace_id
    WHERE workspace_members.user_id = ?
    ORDER BY workspaces.created_at ASC, workspaces.id ASC
  `).bind(user.id).all<Workspace>()).results
}

export async function workspaceForUser(env: Env, user: AuthenticatedUser, workspaceId: string): Promise<Workspace | null> {
  return env.DB.prepare(`
    SELECT workspaces.id, workspaces.name, workspaces.slug, workspaces.created_at, workspaces.updated_at,
      ${user.role === 'super_admin' ? "COALESCE(workspace_members.role, 'owner')" : 'workspace_members.role'} AS role
    FROM workspaces
    ${user.role === 'super_admin' ? 'LEFT JOIN' : 'JOIN'} workspace_members ON workspace_members.workspace_id = workspaces.id AND workspace_members.user_id = ?
    WHERE workspaces.id = ?
    ${user.role === 'super_admin' ? '' : 'AND workspace_members.user_id IS NOT NULL'}
  `).bind(user.id, workspaceId).first<Workspace>()
}

export async function resolveWorkspace(request: Request, env: Env, user: AuthenticatedUser): Promise<{ ok: true; value: WorkspaceContext } | { ok: false; response: Response }> {
  const hinted = request.headers.get('X-Workspace-Id')?.trim() || getCookie(request, WORKSPACE_COOKIE)
  if (hinted) {
    const workspace = await workspaceForUser(env, user, hinted)
    if (!workspace) return { ok: false, response: json({ error: 'Workspace access denied' }, 403) }
    return { ok: true, value: { workspace } }
  }
  const workspaces = await listWorkspaces(env, user)
  if (workspaces.length === 0) return { ok: false, response: json({ error: 'Workspace access denied' }, 403) }
  return { ok: true, value: { workspace: workspaces[0] } }
}

export async function activeWorkspaceId(env: Env, request: Request, user: AuthenticatedUser): Promise<string | null> {
  const resolved = await resolveWorkspace(request, env, user)
  return resolved.ok ? resolved.value.workspace.id : null
}

export function canWrite(workspace: Workspace): boolean {
  return workspace.role === 'owner' || workspace.role === 'operator'
}

export function requireWrite(workspace: Workspace): Response | null {
  return canWrite(workspace) ? null : json({ error: 'Workspace is read-only for viewers' }, 403)
}

export function requireOwner(workspace: Workspace): Response | null {
  return workspace.role === 'owner' ? null : json({ error: 'Workspace owner permission required' }, 403)
}

export async function createWorkspace(env: Env, user: AuthenticatedUser, name: string): Promise<Workspace> {
  const id = `ws_${crypto.randomUUID()}`
  const now = new Date().toISOString()
  const slug = await uniqueSlug(env, name)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name.trim(), slug, user.id, now, now),
    env.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind(id, user.id, 'owner', now),
  ])
  return { id, name: name.trim(), slug, role: 'owner', created_at: now, updated_at: now }
}

async function uniqueSlug(env: Env, name: string): Promise<string> {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`
    const existing = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(candidate).first<{ id: string }>()
    if (!existing) return candidate
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

export async function listWorkspaceMembers(env: Env, workspaceId: string): Promise<WorkspaceMember[]> {
  return (await env.DB.prepare(`
    SELECT users.id AS user_id, users.display_name, users.email, workspace_members.role, workspace_members.created_at
    FROM workspace_members
    JOIN users ON users.id = workspace_members.user_id
    WHERE workspace_members.workspace_id = ?
    ORDER BY CASE workspace_members.role WHEN 'owner' THEN 0 WHEN 'operator' THEN 1 ELSE 2 END, users.display_name ASC
  `).bind(workspaceId).all<WorkspaceMember>()).results
}

export async function ownerCount(env: Env, workspaceId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").bind(workspaceId).first<{ count: number }>()
  return row?.count ?? 0
}

export function parseWorkspaceRole(value: unknown): WorkspaceRole | null {
  return value === 'owner' || value === 'operator' || value === 'viewer' ? value : null
}

/** 全局管理员首次登录时保证至少有一个可切换的工作区。 */
export async function ensureSuperAdminWorkspace(env: Env, userId: string): Promise<void> {
  const user = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: string; role: string }>()
  if (user?.role !== 'super_admin') return
  const now = new Date().toISOString()
  await env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(DEFAULT_WORKSPACE_ID, '默认工作区', 'default', userId, now, now).run()
  await env.DB.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(DEFAULT_WORKSPACE_ID, userId, now).run()
}
