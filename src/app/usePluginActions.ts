import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { checkPluginHealth, commandPlugin, fetchPluginDetails, fetchServerDetails, type ApiPlugin, type ApiPluginDetail, type ApiServerDetail, type PluginAction } from '../api'
import type { Notify } from '../components/ToastProvider'
import { errorMessage } from '../errors'

export type DetailSelection = { kind: 'server' | 'plugin'; id: string }
export type DetailPayload = { kind: 'server'; value: ApiServerDetail } | { kind: 'plugin'; value: ApiPluginDetail }

/**
 * 详情弹窗与插件命令（健康检查 / 启停 / 卸载）：
 * 卸载不可撤销，因此走 Modal.confirm；成功后统一静默重取数据。
 */
export function usePluginActions({ notify, refreshData }: { notify: Notify; refreshData: (announce?: boolean) => Promise<void> }) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [detail, setDetail] = useState<DetailSelection | null>(null)
  const [detailData, setDetailData] = useState<DetailPayload | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [healthPluginId, setHealthPluginId] = useState<string | null>(null)
  const [pluginActionLoading, setPluginActionLoading] = useState<{ id: string; action: Exclude<PluginAction, 'health'> } | null>(null)

  const openDetail = async (kind: 'server' | 'plugin', id: string) => {
    setDetail({ kind, id })
    setDetailData(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      if (kind === 'server') setDetailData({ kind, value: await fetchServerDetails(id) })
      else setDetailData({ kind, value: await fetchPluginDetails(id) })
    } catch (error) {
      setDetailError(errorMessage(error, 'toast.detailFailed'))
    } finally {
      setDetailLoading(false)
    }
  }

  const closeDetail = () => setDetail(null)

  const runHealthCheck = async (plugin: ApiPlugin | { id: string; name: string }) => {
    setHealthPluginId(plugin.id)
    try {
      const result = await checkPluginHealth(plugin.id)
      notify('success', t('toast.healthOk', { name: plugin.name, status: result.status, bodySize: result.bodySize }))
      await refreshData(false)
      if (detail?.kind === 'plugin' && detail.id === plugin.id) void openDetail('plugin', plugin.id)
    } catch (error) {
      notify('error', errorMessage(error, 'toast.healthFailed'))
    } finally {
      setHealthPluginId(null)
    }
  }

  const executePluginAction = async (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => {
    setPluginActionLoading({ id: plugin.id, action })
    try {
      await commandPlugin(plugin.id, action)
      notify('success', t('toast.actionDone', { name: plugin.name, action: t(`pluginActionPast.${action}`) }))
      await refreshData(false)
      if (detail?.kind === 'plugin' && detail.id === plugin.id) void openDetail('plugin', plugin.id)
    } catch (error) {
      notify('error', errorMessage(error, 'toast.actionFailed'))
    } finally {
      setPluginActionLoading(null)
    }
  }

  // 卸载不可撤销，用 AntD Modal.confirm 取代原生 window.confirm，保持主题与键盘可达。
  const runPluginAction = (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => {
    if (action !== 'unload') return executePluginAction(plugin, action)
    modalApi.confirm({
      title: t('toast.unloadConfirm', { name: plugin.name }),
      okText: t('pluginCommands.unload'),
      okButtonProps: { danger: true },
      onOk: () => executePluginAction(plugin, action),
    })
    return Promise.resolve()
  }

  return {
    detail,
    detailData,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
    healthPluginId,
    pluginActionLoading,
    runHealthCheck,
    runPluginAction,
  }
}
