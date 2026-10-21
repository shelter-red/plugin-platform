import { expect, type APIResponse } from '@playwright/test'
import { getPublic, makeTarget, type Target } from './public-client'
import { startRealServer, type RealServer } from './real-stack-server'

export type Api = (path: string, init?: RequestInit) => Promise<APIResponse>

export type PublicPlugin = { server: RealServer; pluginId: string; target: Target }

/** 用一次性注册码拉起真实 C++ 服务器，加载并启用 sample.plugin，分配域名后等到公开入口返回 200。 */
export async function preparePublicPlugin(baseURL: string, api: Api): Promise<PublicPlugin> {
  const { code } = (await (await api('/api/registration-codes', { method: 'POST' })).json()) as { code: string }
  const server = await startRealServer(baseURL, code)
  try {
    await expect
      .poll(async () => {
        const body = (await (await api('/api/servers')).json()) as { results: Array<{ id: string; name: string; status: string }> }
        return body.results.find((item) => item.name === server.name)?.status
      }, { timeout: 60_000 })
      .toBe('online')

    const servers = (await (await api('/api/servers')).json()) as { results: Array<{ id: string; name: string }> }
    const serverId = servers.results.find((item) => item.name === server.name)!.id
    const plugins = (await (await api('/api/plugins')).json()) as { results: Array<{ id: string; plugin_id: string; server_id: string }> }
    const plugin = plugins.results.find((item) => item.server_id === serverId && item.plugin_id === 'sample.plugin')
    expect(plugin, 'sample.plugin 应已注册到新服务器').toBeTruthy()

    await api(`/api/plugins/${plugin!.id}/load`, { method: 'POST' })
    await expect
      .poll(async () => {
        const body = (await (await api(`/api/plugins/${plugin!.id}`)).json()) as { plugin: { state: string } }
        return body.plugin.state
      }, { timeout: 60_000 })
      .toBe('loaded')
    await api(`/api/plugins/${plugin!.id}/enable`, { method: 'POST' })
    await expect
      .poll(async () => {
        const body = (await (await api(`/api/plugins/${plugin!.id}`)).json()) as { plugin: { state: string } }
        return body.plugin.state
      }, { timeout: 60_000 })
      .toBe('enabled')

    const prefix = `e2e-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`
    const domainResponse = await api('/api/domains', { method: 'POST', data: { pluginInstanceId: plugin!.id, prefix } })
    const { hostname } = (await domainResponse.json()) as { hostname: string }
    const target = makeTarget(baseURL, hostname)
    await expect.poll(async () => (await getPublic(target)).status, { timeout: 30_000 }).toBe(200)
    return { server, pluginId: plugin!.id, target }
  } catch (error) {
    await server.stop()
    throw error
  }
}
