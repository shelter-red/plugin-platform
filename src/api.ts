export type WorkspaceRole = 'owner' | 'operator' | 'viewer'

export interface Workspace {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  user_id: string
  display_name: string
  email: string
  role: WorkspaceRole
  created_at: string
}

export interface ApiMe {
  user: { id?: string; display_name: string; email: string; role?: string }
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}

const WORKSPACE_STORAGE_KEY = 'plugmesh-workspace'
const WORKSPACE_COOKIE = 'plugmesh_workspace'

function readStoredWorkspace(): string | null {
  try { return window.localStorage.getItem(WORKSPACE_STORAGE_KEY) } catch { return null }
}

let activeWorkspaceId: string | null = readStoredWorkspace()

/** 切换工作区后所有请求都带上 X-Workspace-Id，Worker 据此隔离数据。 */
export function setActiveWorkspace(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId
  try {
    if (workspaceId) window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId)
    else window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
  } catch { /* 隐私模式下 localStorage 不可写，退化为仅内存生效。 */ }
  // 同一份选择写入 cookie，供未携带自定义头的同源请求（如直接跳转接口）兜底。
  document.cookie = workspaceId
    ? `${WORKSPACE_COOKIE}=${encodeURIComponent(workspaceId)}; Path=/; SameSite=Lax`
    : `${WORKSPACE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`
}

export function currentWorkspaceId(): string | null {
  return activeWorkspaceId
}

const apiBase = import.meta.env.VITE_API_BASE ?? ''

function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (activeWorkspaceId) headers.set('X-Workspace-Id', activeWorkspaceId)
  return fetch(`${apiBase}${path}`, { ...init, credentials: 'include', headers })
}

/** 服务端稳定错误码、面向用户的 message 和可选字段名都保留到调用方。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
    readonly code?: string,
    readonly accounts?: CloudflareAccountOption[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type ApiErrorBody = { error?: string; message?: string; code?: string; field?: string; accounts?: CloudflareAccountOption[] }

async function readApiError(response: Response): Promise<ApiErrorBody | null> {
  return response.json().catch(() => null) as Promise<ApiErrorBody | null>
}

function errorFromBody(response: Response, body: ApiErrorBody | null, fallback: string): ApiError {
  return new ApiError(response.status, body?.message ?? body?.error ?? fallback, body?.field, body?.code)
}

/** 保留服务端错误码与字段名，便于表单把错误定位到具体输入框。 */
async function assertOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return
  const body = await readApiError(response)
  throw new ApiError(response.status, body?.message ?? body?.error ?? fallback, body?.field, body?.code, body?.accounts)
}

export interface ApiOverview {
  onlineServers: number
  enabledPlugins: number
  domains: number
}

export interface ApiServer {
  id: string
  name: string
  status: 'online' | 'offline' | 'revoked' | string
  last_seen_at: string | null
  created_at: string
}

export interface ApiServerDetail {
  server: ApiServer
  plugins: ApiPlugin[]
  recentErrors: ApiAccessLog[]
}

export interface ApiPlugin {
  id: string
  plugin_id: string
  name: string
  version: string
  state: string
  desired_state: string
  server_id: string
  server_name: string
  domain_hostname: string | null
  manifest_json: string
  updated_at: string
}

export interface ApiPluginDetail {
  plugin: ApiPlugin & {
    created_at: string
    server_status: string
    domain_id: string | null
    domain_status: string | null
  }
  recentErrors: ApiAccessLog[]
}

export interface ApiDomain {
  id: string
  hostname: string
  status: string
  plugin_instance_id: string
  plugin_name: string
  created_at: string
}

interface RegistrationCode {
  code: string
  expiresAt: string
}

interface PluginCommandResult {
  id: string
  state: string
  accepted: boolean
  ok?: boolean
  status?: number
  bodySize?: number
}

export type PluginAction = 'load' | 'unload' | 'enable' | 'disable' | 'reload' | 'health'

export interface PluginHealthResult {
  id: string
  ok: boolean
  status: number
  bodySize: number
}

interface DomainAssignmentResult {
  hostname: string
  status: string
}

export interface ApiAudit {
  id: string
  action: string
  detail_json: string
  created_at: string
  actor_name: string | null
  actor_email: string | null
}

export interface ApiAccessLog {
  id: string
  hostname: string
  method: string
  path: string
  status: number
  duration_ms: number
  error: string | null
  created_at: string
}

interface ApiAccessLogs {
  results: ApiAccessLog[]
  errorCount: number
  since: string
}

/** Cloudflare 免费计划的只读每日额度，来源必须是 subscriptions。 */
export interface CloudflareUsageLimits {
  workerRequests: number
  d1RowsRead: number
  d1RowsWritten: number
  kvRead: number
  kvWrite: number
  kvDelete: number
  kvList: number
  doRequests: number
}

export interface CloudflarePlanSummary {
  id: string | null
  name: string | null
  free: boolean
  confirmed: boolean
}

export interface CloudflareUsage {
  configured?: boolean
  accountIdConfigured?: boolean
  error?: string
  period?: { start: string; end: string }
  d1Period?: { date: string; timezone: 'UTC' }
  requests?: number
  source?: string
  cached?: boolean
  updatedAt?: string
  resourceAnalyticsAvailable?: boolean
  resourceAnalyticsError?: string
  d1?: {
    readQueries: number
    writeQueries: number
    rowsRead: number
    rowsWritten: number
  }
  kv?: {
    read: number
    write: number
    delete: number
    list: number
  }
  durableObjects?: {
    requests: number
    cpuTime: number
    storedBytes: number
  }
  plan?: CloudflarePlanSummary
  limitSource?: 'cloudflare_subscriptions_free_baseline' | 'unavailable'
  limits?: CloudflareUsageLimits | null
}

export interface UsageBreakdownEntry {
  id: string
  label: string
  requests: number
}

export interface LocalUsage {
  /** 平台自身 D1 请求日志统计，与 Cloudflare 凭据无关。 */
  source?: 'platform_local'
  requestCount: number
  activeConnections: number
  r2Bytes: number
  r2Objects: number
  updatedAt: string | null
  snapshots: UsageSnapshot[]
  breakdown: {
    users: UsageBreakdownEntry[]
    plugins: UsageBreakdownEntry[]
    domains: UsageBreakdownEntry[]
  }
}

export interface UsageSnapshot {
  captured_at: string
  request_count: number
  active_connections: number
  r2_bytes: number
  r2_objects: number
}

/** 平台自身可拒绝的资源阈值：只限制本平台能拦下的连接与 R2 存储。 */
export interface PlatformQuotas {
  activeConnections: number
  r2Bytes: number
  r2Objects: number
}

export interface PlatformSettings {
  maintenance: boolean
  pluginDomainSuffix: string
  quotas: PlatformQuotas
}

export type SmtpAuthType = 'plain' | 'login' | 'cram-md5'

export interface SmtpSettings {
  configured: boolean
  host?: string
  port?: number
  secure?: boolean
  username?: string
  authType?: SmtpAuthType
  from?: string
  fromName?: string | null
  replyTo?: string | null
  updatedAt?: string | null
}

export interface SmtpSettingsInput {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  authType: SmtpAuthType
  from: string
  fromName?: string
  replyTo?: string
}

export interface CloudflareSettings {
  configured: boolean
  credentialKind: 'global_api_key' | null
  accountIdConfigured: boolean
  accountId: string | null
  email: string | null
  updatedAt: string | null
  lastVerifiedAt: string | null
}

export interface CloudflareSettingsInput {
  email: string
  globalApiKey: string
  accountId?: string
}

export interface CloudflareAccountOption {
  id: string
  name: string
}

export async function fetchOverview(): Promise<ApiOverview> {
  const response = await apiRequest(`/api/overview`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'overview request failed')
  return response.json() as Promise<ApiOverview>
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const response = await apiRequest(`/api/settings/platform`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'platform settings request failed')
  return response.json() as Promise<PlatformSettings>
}

export async function fetchServers(): Promise<ApiServer[]> {
  const response = await apiRequest(`/api/servers`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'servers request failed')
  const data = await response.json() as { results?: ApiServer[] }
  return data.results ?? []
}

export async function fetchServerDetails(serverId: string): Promise<ApiServerDetail> {
  const response = await apiRequest(`/api/servers/${encodeURIComponent(serverId)}`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'server detail request failed')
  return response.json() as Promise<ApiServerDetail>
}

export async function fetchPlugins(): Promise<ApiPlugin[]> {
  const response = await apiRequest(`/api/plugins`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'plugins request failed')
  const data = await response.json() as { results?: ApiPlugin[] }
  return data.results ?? []
}

export async function fetchPluginDetails(pluginInstanceId: string): Promise<ApiPluginDetail> {
  const response = await apiRequest(`/api/plugins/${encodeURIComponent(pluginInstanceId)}`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'plugin detail request failed')
  return response.json() as Promise<ApiPluginDetail>
}

export async function fetchDomains(): Promise<ApiDomain[]> {
  const response = await apiRequest(`/api/domains`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'domains request failed')
  const data = await response.json() as { results?: ApiDomain[] }
  return data.results ?? []
}

export async function fetchAudit(): Promise<ApiAudit[]> {
  const response = await apiRequest(`/api/audit`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'audit request failed')
  const data = await response.json() as { results?: ApiAudit[] }
  return data.results ?? []
}

export async function fetchAccessLogs(): Promise<ApiAccessLogs> {
  const response = await apiRequest(`/api/access-logs`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'access logs request failed')
  return response.json() as Promise<ApiAccessLogs>
}

async function apiError(response: Response, fallback: string): Promise<ApiError> {
  return errorFromBody(response, await readApiError(response), fallback)
}

export async function createRegistrationCode(): Promise<RegistrationCode> {
  const response = await apiRequest(`/api/registration-codes`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'registration code request failed')
  return response.json() as Promise<RegistrationCode>
}

export async function commandPlugin(pluginInstanceId: string, action: PluginAction): Promise<PluginCommandResult> {
  const response = await apiRequest(`/api/plugins/${encodeURIComponent(pluginInstanceId)}/${action}`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `plugin command failed: ${response.status}`)
  return response.json() as Promise<PluginCommandResult>
}

export async function syncServer(serverId: string): Promise<PluginCommandResult> {
  const response = await apiRequest(`/api/servers/${encodeURIComponent(serverId)}/sync`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `server sync failed: ${response.status}`)
  return response.json() as Promise<PluginCommandResult>
}

export async function checkPluginHealth(pluginInstanceId: string): Promise<PluginHealthResult> {
  const response = await apiRequest(`/api/plugins/${encodeURIComponent(pluginInstanceId)}/health`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `plugin health check failed: ${response.status}`)
  return response.json() as Promise<PluginHealthResult>
}

export async function assignDomain(pluginInstanceId: string, prefix: string): Promise<DomainAssignmentResult> {
  const response = await apiRequest(`/api/domains`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginInstanceId, prefix }) })
  if (!response.ok) throw await apiError(response, `domain assignment failed: ${response.status}`)
  return response.json() as Promise<DomainAssignmentResult>
}

export async function fetchCloudflareUsage(): Promise<CloudflareUsage> {
  const response = await apiRequest(`/api/usage/cloudflare`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'cloudflare usage request failed')
  return response.json() as Promise<CloudflareUsage>
}

export async function fetchLocalUsage(range: '24h' | '7d' | '30d' = '7d'): Promise<LocalUsage> {
  const response = await apiRequest(`/api/usage/local?range=${range}`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'local usage request failed')
  return response.json() as Promise<LocalUsage>
}

export async function updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  const response = await apiRequest(`/api/settings/platform`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  await assertOk(response, 'platform settings update request failed')
  return response.json() as Promise<PlatformSettings>
}

export async function fetchCloudflareSettings(): Promise<CloudflareSettings> {
  const response = await apiRequest(`/api/settings/cloudflare`, { credentials: 'include' })
  await assertOk(response, 'cloudflare settings request failed')
  return response.json() as Promise<CloudflareSettings>
}

/** 保存前由 Worker 验证 Global API Key、账号可见性与订阅；不会回显密钥。 */
export async function updateCloudflareSettings(input: CloudflareSettingsInput): Promise<CloudflareSettings> {
  const response = await apiRequest(`/api/settings/cloudflare`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  await assertOk(response, 'cloudflare settings update request failed')
  return response.json() as Promise<CloudflareSettings>
}

export async function revokeCloudflareSettings(): Promise<CloudflareSettings> {
  const response = await apiRequest(`/api/settings/cloudflare`, { method: 'DELETE', credentials: 'include' })
  await assertOk(response, 'cloudflare settings revoke request failed')
  return response.json() as Promise<CloudflareSettings>
}

export async function fetchSmtpSettings(): Promise<SmtpSettings> {
  const response = await apiRequest(`/api/settings/smtp`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'smtp settings request failed')
  return response.json() as Promise<SmtpSettings>
}

export async function updateSmtpSettings(settings: SmtpSettingsInput): Promise<SmtpSettings> {
  const response = await apiRequest(`/api/settings/smtp`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  await assertOk(response, 'smtp settings update request failed')
  return response.json() as Promise<SmtpSettings>
}

/** 测试发送使用当前表单值，密码为空时由服务端沿用已保存密钥。 */
export async function sendSmtpTest(to: string, settings?: SmtpSettingsInput): Promise<void> {
  const response = await apiRequest(`/api/settings/smtp/test`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, ...(settings ? { settings } : {}) }) })
  await assertOk(response, 'smtp test request failed')
}

export async function fetchMe(): Promise<ApiMe> {
  const response = await apiRequest('/api/me')
  await assertOk(response, 'me request failed')
  return response.json() as Promise<ApiMe>
}

export async function loginWithPassword(password: string): Promise<void> {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  await assertOk(response, 'password login failed')
}

export async function changeAdminPassword(currentPassword: string, newPassword: string, confirmPassword: string): Promise<void> {
  const response = await apiRequest('/api/settings/password', { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) })
  await assertOk(response, 'password change failed')
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const response = await apiRequest('/api/workspaces')
  await assertOk(response, 'workspaces request failed')
  const data = await response.json() as { results?: Workspace[] }
  return data.results ?? []
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const response = await apiRequest('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
  await assertOk(response, 'workspace creation failed')
  return response.json() as Promise<Workspace>
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<Workspace> {
  const response = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
  await assertOk(response, 'workspace rename failed')
  return response.json() as Promise<Workspace>
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const response = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' })
  await assertOk(response, 'workspace deletion failed')
}

export async function fetchWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const response = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`)
  await assertOk(response, 'workspace members request failed')
  const data = await response.json() as { results?: WorkspaceMember[] }
  return data.results ?? []
}

export async function addWorkspaceMember(workspaceId: string, input: { userId?: string; email?: string; role: WorkspaceRole }): Promise<void> {
  const response = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  await assertOk(response, 'workspace member addition failed')
}

export async function updateWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  const response = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })
  await assertOk(response, 'workspace member update failed')
}

export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const response = await apiRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })
  await assertOk(response, 'workspace member removal failed')
}
