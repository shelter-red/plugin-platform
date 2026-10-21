export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
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

export interface ApiInvite {
  id: string
  email: string | null
  github_login: string | null
  status: 'pending' | 'used' | 'expired' | 'revoked' | string
  expires_at: string
  used_at: string | null
  created_at: string
}

interface InviteCreation {
  id: string
  inviteUrl: string
  expiresAt: string
  emailSent: boolean | null
}

export interface CloudflareUsage {
  configured?: boolean
  accountIdConfigured?: boolean
  period?: { start: string; end: string }
  requests?: number
  source?: string
  cached?: boolean
  updatedAt?: string
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
}

export interface LocalUsage {
  requestCount: number
  requestWindowStartedAt: string | null
  activeConnections: number
  r2Bytes: number
  r2Objects: number
  updatedAt: string | null
  snapshots: UsageSnapshot[]
}

export interface UsageSnapshot {
  captured_at: string
  request_count: number
  active_connections: number
  r2_bytes: number
  r2_objects: number
}

export interface PlatformSettings {
  maintenance: boolean
  quotas: {
    requests: number
    activeConnections: number
    r2Bytes: number
    r2Objects: number
    d1Queries: number
    kvOperations: number
    durableObjectRequests: number
  }
}

export interface SmtpSettings {
  configured: boolean
  host?: string
  port?: number
  secure?: boolean
  username?: string
  authType?: 'plain' | 'login' | 'cram-md5'
  from?: string
  fromName?: string | null
  replyTo?: string | null
  updatedAt?: string | null
}

export interface CloudflareSettings {
  configured: boolean
  accountIdConfigured: boolean
  accountId: string | null
  updatedAt: string | null
}

export async function fetchOverview(): Promise<ApiOverview> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/overview`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'overview request failed')
  return response.json() as Promise<ApiOverview>
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/platform`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'platform settings request failed')
  return response.json() as Promise<PlatformSettings>
}

export async function fetchServers(): Promise<ApiServer[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/servers`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'servers request failed')
  const data = await response.json() as { results?: ApiServer[] }
  return data.results ?? []
}

export async function fetchServerDetails(serverId: string): Promise<ApiServerDetail> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/servers/${encodeURIComponent(serverId)}`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'server detail request failed')
  return response.json() as Promise<ApiServerDetail>
}

export async function fetchPlugins(): Promise<ApiPlugin[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/plugins`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'plugins request failed')
  const data = await response.json() as { results?: ApiPlugin[] }
  return data.results ?? []
}

export async function fetchPluginDetails(pluginInstanceId: string): Promise<ApiPluginDetail> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/plugins/${encodeURIComponent(pluginInstanceId)}`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'plugin detail request failed')
  return response.json() as Promise<ApiPluginDetail>
}

export async function fetchDomains(): Promise<ApiDomain[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/domains`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'domains request failed')
  const data = await response.json() as { results?: ApiDomain[] }
  return data.results ?? []
}

export async function fetchAudit(): Promise<ApiAudit[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/audit`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'audit request failed')
  const data = await response.json() as { results?: ApiAudit[] }
  return data.results ?? []
}

export async function fetchAccessLogs(): Promise<ApiAccessLogs> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/access-logs`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'access logs request failed')
  return response.json() as Promise<ApiAccessLogs>
}

export async function fetchInvites(): Promise<ApiInvite[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/invites`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'invites request failed')
  const data = await response.json() as { results?: ApiInvite[] }
  return data.results ?? []
}

async function apiError(response: Response, fallback: string): Promise<ApiError> {
  const data = await response.json().catch(() => null) as { error?: string } | null
  return new ApiError(response.status, data?.error || fallback)
}

export async function createRegistrationCode(): Promise<RegistrationCode> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/registration-codes`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'registration code request failed')
  return response.json() as Promise<RegistrationCode>
}

export async function createInvite(input: { email?: string; githubLogin?: string; expiresInHours: number }): Promise<InviteCreation> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/invites`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw await apiError(response, `invite creation failed: ${response.status}`)
  return response.json() as Promise<InviteCreation>
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `invite revoke failed: ${response.status}`)
}

export async function commandPlugin(pluginInstanceId: string, action: PluginAction): Promise<PluginCommandResult> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/plugins/${encodeURIComponent(pluginInstanceId)}/${action}`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `plugin command failed: ${response.status}`)
  return response.json() as Promise<PluginCommandResult>
}

export async function syncServer(serverId: string): Promise<PluginCommandResult> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/servers/${encodeURIComponent(serverId)}/sync`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `server sync failed: ${response.status}`)
  return response.json() as Promise<PluginCommandResult>
}

export async function checkPluginHealth(pluginInstanceId: string): Promise<PluginHealthResult> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/plugins/${encodeURIComponent(pluginInstanceId)}/health`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `plugin health check failed: ${response.status}`)
  return response.json() as Promise<PluginHealthResult>
}

export async function assignDomain(pluginInstanceId: string, prefix: string): Promise<DomainAssignmentResult> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/domains`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginInstanceId, prefix }) })
  if (!response.ok) throw await apiError(response, `domain assignment failed: ${response.status}`)
  return response.json() as Promise<DomainAssignmentResult>
}

export async function fetchCloudflareUsage(): Promise<CloudflareUsage> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/usage/cloudflare`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'cloudflare usage request failed')
  return response.json() as Promise<CloudflareUsage>
}

export async function fetchLocalUsage(range: '24h' | '7d' | '30d' = '7d'): Promise<LocalUsage> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/usage/local?range=${range}`, { credentials: 'include' })
  if (!response.ok) throw await apiError(response, 'local usage request failed')
  return response.json() as Promise<LocalUsage>
}

export async function updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/platform`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  if (!response.ok) throw new ApiError(response.status, 'platform settings update request failed')
  return response.json() as Promise<PlatformSettings>
}

export async function fetchCloudflareSettings(): Promise<CloudflareSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/cloudflare`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'cloudflare settings request failed')
  return response.json() as Promise<CloudflareSettings>
}

export async function revokeCloudflareSettings(): Promise<CloudflareSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/cloudflare`, { method: 'DELETE', credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'cloudflare settings revoke request failed')
  return response.json() as Promise<CloudflareSettings>
}

export async function fetchSmtpSettings(): Promise<SmtpSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/smtp`, { credentials: 'include' })
  if (!response.ok) throw new ApiError(response.status, 'smtp settings request failed')
  return response.json() as Promise<SmtpSettings>
}

export async function updateSmtpSettings(settings: { host: string; port: number; secure: boolean; username: string; password: string; authType: 'plain' | 'login' | 'cram-md5'; from: string; fromName?: string; replyTo?: string }): Promise<SmtpSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/smtp`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  if (!response.ok) throw new ApiError(response.status, 'smtp settings update request failed')
  return response.json() as Promise<SmtpSettings>
}

export async function sendSmtpTest(to: string): Promise<void> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/smtp/test`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) })
  if (!response.ok) throw new ApiError(response.status, 'smtp test request failed')
}
