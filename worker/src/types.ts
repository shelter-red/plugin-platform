export interface PlatformQuotas {
  requests: number
  activeConnections: number
  r2Bytes: number
  r2Objects: number
  d1Queries: number
  kvOperations: number
  durableObjectRequests: number
}

export interface PlatformSettings {
  maintenance: boolean
  quotas: PlatformQuotas
}

export interface Env {
  DB: D1Database
  BLOB_BUCKET: R2Bucket
  PLUGIN_BRIDGE: DurableObjectNamespace
  ASSETS?: Fetcher
  PLUGIN_DOMAIN_SUFFIX?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_REDIRECT_URI?: string
  GITHUB_ALLOWLIST?: string
  SESSION_SECRET?: string
  SETUP_TOKEN?: string
  CLOUDFLARE_OAUTH_CLIENT_ID?: string
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string
  CLOUDFLARE_OAUTH_REDIRECT_URI?: string
  CLOUDFLARE_OAUTH_SCOPE?: string
}

export interface AuthenticatedUser {
  id: string
  github_id: string
  email: string
  display_name: string
  role: 'super_admin' | 'member'
}

export interface ControlFrame {
  protocolVersion: 1
  type: string
  requestId: string
  serverId: string
  pluginId?: string
  timestamp: string
  nonce: string
  payload?: Record<string, unknown>
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  abiVersion: string
  library: string
  capabilities: {
    http: boolean
    websocket: boolean
    sse: boolean
    fileStream: boolean
  }
  permissions: string[]
  healthPath: string
}
