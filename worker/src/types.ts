// 平台自身可拒绝的资源阈值：只约束本平台能拦下的连接与 R2 存储，达到后进入维护模式。
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

export interface Env {
  DB: D1Database
  BLOB_BUCKET: R2Bucket
  PLUGIN_BRIDGE: DurableObjectNamespace
  TUNNEL_SESSION: DurableObjectNamespace
  ASSETS?: Fetcher
  PLUGIN_DOMAIN_SUFFIX?: string
  CONSOLE_HOSTNAME?: string
  SESSION_SECRET?: string
}

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

export interface AuthenticatedUser {
  id: string
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

/** Cloudflare 免费计划的只读每日额度，来源必须是 subscriptions，而不是平台设置。 */
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
