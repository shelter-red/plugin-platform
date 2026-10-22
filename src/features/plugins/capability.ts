import type { ApiPlugin } from '../../api'
import i18n from '../../i18n'

/** 从 manifest 提取能力标签；损坏的 manifest 单独显示为无效，避免误导为“无能力”。 */
export function capabilityLabel(plugin: ApiPlugin): string {
  try {
    const manifest = JSON.parse(plugin.manifest_json) as { capabilities?: Record<string, unknown> }
    const labels = [
      ['http', 'HTTP'],
      ['websocket', 'WebSocket'],
      ['sse', 'SSE'],
      ['fileStream', i18n.t('capabilities.fileStream')],
    ].filter(([key]) => manifest.capabilities?.[key] === true).map(([, label]) => label)
    return labels.length > 0 ? labels.join(' + ') : i18n.t('capabilities.none')
  } catch {
    return i18n.t('capabilities.invalid')
  }
}
