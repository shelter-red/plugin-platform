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

export interface ApiPlugin {
  id: string
  plugin_id: string
  name: string
  version: string
  state: string
  server_id: string
  server_name: string
  domain_hostname: string | null
  manifest_json: string
  updated_at: string
}

export interface ApiDomain {
  id: string
  hostname: string
  status: string
  plugin_instance_id: string
  plugin_name: string
  created_at: string
}

export interface RegistrationCode {
  code: string
  expiresAt: string
}

export interface PluginCommandResult {
  id: string
  state: string
  accepted: boolean
}

export interface DomainAssignmentResult {
  hostname: string
  status: string
}

export interface PlatformSettings {
  maintenance: boolean
  quotas: {
    requests: number
    activeConnections: number
    r2Bytes: number
    r2Objects: number
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
  if (!response.ok) throw new Error(`overview request failed: ${response.status}`)
  return response.json() as Promise<ApiOverview>
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/platform`, { credentials: 'include' })
  if (!response.ok) throw new Error(`platform settings request failed: ${response.status}`)
  return response.json() as Promise<PlatformSettings>
}

export async function fetchServers(): Promise<ApiServer[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/servers`, { credentials: 'include' })
  if (!response.ok) throw new Error(`servers request failed: ${response.status}`)
  const data = await response.json() as { results?: ApiServer[] }
  return data.results ?? []
}

export async function fetchPlugins(): Promise<ApiPlugin[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/plugins`, { credentials: 'include' })
  if (!response.ok) throw new Error(`plugins request failed: ${response.status}`)
  const data = await response.json() as { results?: ApiPlugin[] }
  return data.results ?? []
}

export async function fetchDomains(): Promise<ApiDomain[]> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/domains`, { credentials: 'include' })
  if (!response.ok) throw new Error(`domains request failed: ${response.status}`)
  const data = await response.json() as { results?: ApiDomain[] }
  return data.results ?? []
}

async function apiError(response: Response, fallback: string): Promise<Error> {
  const data = await response.json().catch(() => null) as { error?: string } | null
  return new Error(data?.error || fallback)
}

export async function createRegistrationCode(): Promise<RegistrationCode> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/registration-codes`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `registration code request failed: ${response.status}`)
  return response.json() as Promise<RegistrationCode>
}

export async function commandPlugin(pluginInstanceId: string, action: 'load' | 'unload' | 'enable' | 'disable' | 'reload'): Promise<PluginCommandResult> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/plugins/${encodeURIComponent(pluginInstanceId)}/${action}`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw await apiError(response, `plugin command failed: ${response.status}`)
  return response.json() as Promise<PluginCommandResult>
}

export async function assignDomain(pluginInstanceId: string, prefix: string): Promise<DomainAssignmentResult> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/domains`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pluginInstanceId, prefix }) })
  if (!response.ok) throw await apiError(response, `domain assignment failed: ${response.status}`)
  return response.json() as Promise<DomainAssignmentResult>
}

export async function updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/platform`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  if (!response.ok) throw new Error(`platform settings update failed: ${response.status}`)
  return response.json() as Promise<PlatformSettings>
}

export async function fetchCloudflareSettings(): Promise<CloudflareSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/cloudflare`, { credentials: 'include' })
  if (!response.ok) throw new Error(`cloudflare settings request failed: ${response.status}`)
  return response.json() as Promise<CloudflareSettings>
}

export async function revokeCloudflareSettings(): Promise<CloudflareSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/cloudflare`, { method: 'DELETE', credentials: 'include' })
  if (!response.ok) throw new Error(`cloudflare settings revoke failed: ${response.status}`)
  return response.json() as Promise<CloudflareSettings>
}

export async function fetchSmtpSettings(): Promise<SmtpSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/smtp`, { credentials: 'include' })
  if (!response.ok) throw new Error(`smtp settings request failed: ${response.status}`)
  return response.json() as Promise<SmtpSettings>
}

export async function updateSmtpSettings(settings: { host: string; port: number; secure: boolean; username: string; password: string; authType: 'plain' | 'login' | 'cram-md5'; from: string; fromName?: string; replyTo?: string }): Promise<SmtpSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/smtp`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  if (!response.ok) throw new Error(`smtp settings update failed: ${response.status}`)
  return response.json() as Promise<SmtpSettings>
}

export async function sendSmtpTest(to: string): Promise<void> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/smtp/test`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to }) })
  if (!response.ok) throw new Error(`smtp test failed: ${response.status}`)
}
