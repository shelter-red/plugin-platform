export interface ApiOverview {
  onlineServers: number
  enabledPlugins: number
  domains: number
}

export async function fetchOverview(): Promise<ApiOverview> {
  const apiBase = import.meta.env.VITE_API_BASE ?? ''
  const response = await fetch(`${apiBase}/api/overview`, { credentials: 'include' })
  if (!response.ok) throw new Error(`overview request failed: ${response.status}`)
  return response.json() as Promise<ApiOverview>
}
