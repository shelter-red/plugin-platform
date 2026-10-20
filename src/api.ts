export interface ApiOverview {
  onlineServers: number
  enabledPlugins: number
  domains: number
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

export async function updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/settings/platform`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) })
  if (!response.ok) throw new Error(`platform settings update failed: ${response.status}`)
  return response.json() as Promise<PlatformSettings>
}
