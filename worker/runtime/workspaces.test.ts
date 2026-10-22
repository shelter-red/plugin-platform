import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { addWorkspaceMember, hashToken, resetDatabase, seedServer, testEnv, DEFAULT_WORKSPACE_ID } from './helpers'

const OWNER_TOKEN = 'workspace-owner-token'
const VIEWER_TOKEN = 'workspace-viewer-token'
const OUTSIDER_TOKEN = 'workspace-outsider-token'
const ADMIN_TOKEN = 'workspace-admin-token'

const authHeaders = (token: string, workspaceId?: string, json = false): Record<string, string> => ({
  cookie: `plugmesh_session=${token}`,
  ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
  ...(json ? { 'content-type': 'application/json' } : {}),
})

const api = (path: string, token: string, init: RequestInit = {}, workspaceId?: string): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, { ...init, headers: { ...authHeaders(token, workspaceId, Boolean(init.body)), ...(init.headers as Record<string, string> | undefined) } })

async function seedUser(id: string, email: string, role: 'member' | 'super_admin' = 'member'): Promise<void> {
  await testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, `gh-${id}`, email, email.split('@')[0], role, new Date().toISOString()).run()
}

async function seedSession(userId: string, token: string): Promise<void> {
  await testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(`session-${userId}`, userId, await hashToken(token), new Date(Date.now() + 3_600_000).toISOString(), new Date().toISOString()).run()
}

async function createWorkspace(token: string, name: string): Promise<{ id: string; name: string; role: string }> {
  const response = await api('/api/workspaces', token, { method: 'POST', body: JSON.stringify({ name }) })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string; name: string; role: string }>
}

beforeEach(async () => {
  await resetDatabase()
  setPlatformSettingsCache(defaultPlatformSettings)
})

test('工作区 API 返回当前工作区并隔离不同工作区的数据', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedSession('user-runtime', OWNER_TOKEN)

  const me = await api('/api/me', OWNER_TOKEN)
  expect(me.status).toBe(200)
  const meBody = await me.json() as { workspaces: Array<{ id: string; role: string }>; activeWorkspaceId: string }
  expect(meBody.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID)
  expect(meBody.workspaces.map((workspace) => workspace.id)).toContain(DEFAULT_WORKSPACE_ID)
  expect(meBody.workspaces[0].role).toBe('owner')

  const created = await createWorkspace(OWNER_TOKEN, '隔离工作区')
  expect(created.role).toBe('owner')

  const defaultServers = await api('/api/servers', OWNER_TOKEN, {}, DEFAULT_WORKSPACE_ID)
  expect((await defaultServers.json() as { results: unknown[] }).results).toHaveLength(1)

  const isolatedServers = await api('/api/servers', OWNER_TOKEN, {}, created.id)
  expect(isolatedServers.status).toBe(200)
  expect((await isolatedServers.json() as { results: unknown[] }).results).toHaveLength(0)

  const listed = await api('/api/workspaces', OWNER_TOKEN)
  expect((await listed.json() as { results: Array<{ id: string }> }).results.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, created.id])

  expect((await api(`/api/workspaces/${DEFAULT_WORKSPACE_ID}`, OWNER_TOKEN, { method: 'DELETE' })).status).toBe(409)
  expect((await api(`/api/workspaces/${created.id}`, OWNER_TOKEN, { method: 'DELETE' })).status).toBe(200)
})

test('工作区角色限制写入与成员管理权限', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedSession('user-runtime', OWNER_TOKEN)
  await seedUser('user-viewer', 'viewer@example.com')
  await seedSession('user-viewer', VIEWER_TOKEN)
  await addWorkspaceMember('user-viewer', 'viewer')

  const read = await api('/api/servers', VIEWER_TOKEN)
  expect(read.status).toBe(200)

  const forbiddenWrite = await api('/api/registration-codes', VIEWER_TOKEN, { method: 'POST' })
  expect(forbiddenWrite.status).toBe(403)
  expect(await forbiddenWrite.json()).toEqual({ error: 'Workspace is read-only for viewers' })

  const forbiddenInvite = await api('/api/invites', VIEWER_TOKEN, { method: 'POST', body: JSON.stringify({ email: 'invite@example.com' }) })
  expect(forbiddenInvite.status).toBe(403)

  const members = await api(`/api/workspaces/${DEFAULT_WORKSPACE_ID}/members`, OWNER_TOKEN)
  expect(members.status).toBe(200)
  const memberRows = (await members.json() as { results: Array<{ user_id: string; role: string }> }).results
  expect(memberRows.map((member) => member.user_id)).toEqual(['user-runtime', 'user-viewer'])

  expect((await api(`/api/workspaces/${DEFAULT_WORKSPACE_ID}/members`, VIEWER_TOKEN, { method: 'POST', body: JSON.stringify({ email: 'viewer@example.com', role: 'operator' }) })).status).toBe(403)

  const promoted = await api(`/api/workspaces/${DEFAULT_WORKSPACE_ID}/members/user-viewer`, OWNER_TOKEN, { method: 'PUT', body: JSON.stringify({ role: 'operator' }) })
  expect(promoted.status).toBe(200)
  expect((await api('/api/registration-codes', VIEWER_TOKEN, { method: 'POST' })).status).toBe(201)

  expect((await api(`/api/workspaces/${DEFAULT_WORKSPACE_ID}/members/user-runtime`, OWNER_TOKEN, { method: 'DELETE' })).status).toBe(409)

  const added = await api(`/api/workspaces/${DEFAULT_WORKSPACE_ID}/members`, OWNER_TOKEN, { method: 'POST', body: JSON.stringify({ email: 'viewer@example.com', role: 'owner' }) })
  expect(added.status).toBe(201)
})

test('非成员无法访问其他工作区，超级管理员可见全部工作区', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedSession('user-runtime', OWNER_TOKEN)
  await seedUser('user-outsider', 'outsider@example.com')
  await seedSession('user-outsider', OUTSIDER_TOKEN)
  await seedUser('user-admin', 'admin@example.com', 'super_admin')
  await seedSession('user-admin', ADMIN_TOKEN)

  const denied = await api('/api/servers', OUTSIDER_TOKEN, {}, DEFAULT_WORKSPACE_ID)
  expect(denied.status).toBe(403)
  expect(await denied.json()).toEqual({ error: 'Workspace access denied' })

  const outsiderMe = await api('/api/me', OUTSIDER_TOKEN)
  expect((await outsiderMe.json() as { workspaces: unknown[] }).workspaces).toHaveLength(0)

  const created = await createWorkspace(OWNER_TOKEN, '管理员可见工作区')

  const adminWorkspaces = await api('/api/workspaces', ADMIN_TOKEN)
  expect((await adminWorkspaces.json() as { results: Array<{ id: string; role: string }> }).results.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, created.id])
  expect((await api('/api/servers', ADMIN_TOKEN, {}, created.id)).status).toBe(200)
})
