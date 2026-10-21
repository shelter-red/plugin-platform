import { parseResponseStatus } from './response-validation'

export type RestorablePluginState = 'loaded' | 'enabled' | 'disabled'

export type PluginCommandResult = {
  ok: boolean
  status?: number
}

export async function restorePluginState(pluginId: string, desiredState: RestorablePluginState, sendCommand: (type: string, pluginId: string) => Promise<PluginCommandResult>): Promise<RestorablePluginState | 'failed'> {
  const initialAction = desiredState === 'enabled' ? 'plugin.enable' : 'plugin.load'
  if (!(await sendCommand(initialAction, pluginId)).ok) return 'failed'

  if (desiredState === 'disabled') {
    if (!(await sendCommand('plugin.disable', pluginId)).ok) return 'failed'
    return 'disabled'
  }

  if (desiredState === 'enabled') {
    const health = await sendCommand('plugin.health', pluginId)
    const status = parseResponseStatus(health.status)
    if (!health.ok || status === null || status >= 400) return 'failed'
  }
  return desiredState
}

