import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { detailedErrorMessage } from '../errors'
import type { Notify } from '../components/ToastProvider'
import { ApiError, currentWorkspaceId, fetchAccessLogs, fetchAudit, fetchCloudflareSettings, fetchCloudflareUsage, fetchDomains, fetchLocalUsage, fetchMe, fetchOverview, fetchPlatformSettings, fetchPlugins, fetchServers, fetchSmtpSettings, fetchWorkspaces, setActiveWorkspace as applyActiveWorkspace, type ApiAccessLog, type ApiAudit, type ApiDomain, type ApiMe, type ApiOverview, type ApiPlugin, type ApiServer, type CloudflareSettings, type CloudflareUsage, type LocalUsage, type PlatformSettings, type SmtpSettings, type Workspace } from '../api'

export type AuthState = 'loading' | 'authenticated' | 'anonymous'

/**
 * 控制台数据层：登录态、工作区解析、各页数据与刷新动作。
 * 外壳只负责排版，UI 局部状态（弹窗、详情、命令面板）仍留在组件里。
 */
export function useConsoleData({ notify }: { notify: Notify }) {
  const { t } = useTranslation()
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== 'false'
  // 纯静态预览（无鉴权且未配置 API 地址）不发起任何 Worker 请求，保持空态展示。
  const apiConnected = authEnabled || Boolean(import.meta.env.VITE_API_BASE)
  const [authState, setAuthState] = useState<AuthState>(authEnabled ? 'loading' : 'authenticated')
  const [authUser, setAuthUser] = useState<ApiMe['user'] | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceKey, setWorkspaceKey] = useState(0)
  const [workspaceReady, setWorkspaceReady] = useState(!apiConnected)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  // 尚未接入 Worker（纯静态预览）时不做角色限制；接入后必须由已解析工作区的角色决定。
  const canWrite = activeWorkspace ? activeWorkspace.role !== 'viewer' : !apiConnected
  // 静态预览没有登录态，保持原有演示能力；接入 Worker 后严格以真实角色判断。
  const isSuperAdmin = !apiConnected || authUser?.role === 'super_admin'
  const [overview, setOverview] = useState<ApiOverview | null>(null)
  const [servers, setServers] = useState<ApiServer[] | null>(null)
  const [plugins, setPlugins] = useState<ApiPlugin[] | null>(null)
  const [domains, setDomains] = useState<ApiDomain[] | null>(null)
  const [audits, setAudits] = useState<ApiAudit[] | null>(null)
  const [accessLogs, setAccessLogs] = useState<ApiAccessLog[] | null>(null)
  const [usage, setUsage] = useState<CloudflareUsage | null>(null)
  const [localUsage, setLocalUsage] = useState<LocalUsage | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)
  // 自动加载与手动刷新分开：自动加载期间不禁用刷新按钮，否则用户（或测试）的点击会被静默吞掉。
  const [usageRefreshing, setUsageRefreshing] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [accessLogsError, setAccessLogsError] = useState<string | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [accessLogsLoading, setAccessLogsLoading] = useState(false)
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null)
  const [cloudflareSettings, setCloudflareSettings] = useState<CloudflareSettings | null>(null)
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null)
  const [apiLive, setApiLive] = useState(false)
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d')

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchMe()
      .then((data) => {
        setAuthUser(data.user ?? null)
        setWorkspaces(data.workspaces ?? [])
        // Worker 已按 Header/Cookie/首个工作区解析，前端直接采用解析结果。
        if (data.activeWorkspaceId) applyActiveWorkspace(data.activeWorkspaceId)
        setActiveWorkspaceId(data.activeWorkspaceId ?? null)
        setWorkspaceReady(true)
        if (authEnabled) setAuthState('authenticated')
      })
      .catch((error) => {
        if (error instanceof ApiError && error.code === 'setup_required' && window.location.pathname !== '/setup') {
          window.location.assign('/setup')
          return
        }
        setWorkspaceReady(true)
        if (authEnabled) setAuthState('anonymous')
      })
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchSmtpSettings().then(setSmtpSettings).catch(() => setSmtpSettings(null))
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchCloudflareSettings().then(setCloudflareSettings).catch(() => setCloudflareSettings(null))
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchPlatformSettings().then(setPlatformSettings).catch(() => setPlatformSettings(null))
  }, [authEnabled])

  useEffect(() => {
    if (!apiConnected || !workspaceReady) return
    fetchOverview().then((data) => {
      setOverview(data)
      setApiLive(true)
    }).catch(() => setApiLive(false))
  }, [workspaceReady, workspaceKey])

  useEffect(() => {
    if (!apiConnected || !workspaceReady) return
    setDataLoading(true)
    Promise.all([fetchServers(), fetchPlugins(), fetchDomains()]).then(([nextServers, nextPlugins, nextDomains]) => {
      setServers(nextServers)
      setPlugins(nextPlugins)
      setDomains(nextDomains)
      setDataError(null)
    }).catch(() => setDataError('toast.dataUnavailable')).finally(() => setDataLoading(false))
  }, [workspaceReady, workspaceKey])

  useEffect(() => {
    if (!apiConnected || !workspaceReady) return
    setAuditLoading(true)
    fetchAudit().then((data) => {
      setAudits(data)
      setAuditError(null)
    }).catch(() => setAuditError('toast.auditUnavailable')).finally(() => setAuditLoading(false))
    setAccessLogsLoading(true)
    fetchAccessLogs().then((data) => {
      setAccessLogs(data.results)
      setAccessLogsError(null)
    }).catch(() => {
      setAccessLogs(null)
      setAccessLogsError('toast.accessLogsUnavailable')
    }).finally(() => setAccessLogsLoading(false))
    setUsageLoading(true)
    fetchCloudflareUsage().then((data) => {
      setUsage(data)
      setUsageError(null)
    }).catch((error) => {
      setUsage(null)
      setUsageError(detailedErrorMessage(error, 'toast.usageUnavailable'))
    }).finally(() => setUsageLoading(false))
  }, [workspaceReady, workspaceKey])

  useEffect(() => {
    if (!apiConnected || !workspaceReady) return
    fetchLocalUsage(range).then(setLocalUsage).catch(() => setLocalUsage(null))
  }, [workspaceReady, workspaceKey, range])

  /** 切换工作区后递增 workspaceKey，让所有按工作区取数的副作用重新执行。 */
  const switchWorkspace = (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) return
    // 新建或删除后列表尚未重新渲染，此时也应立即切换，名称回退到列表中的最新值。
    const next = workspaces.find((workspace) => workspace.id === workspaceId)
    applyActiveWorkspace(workspaceId)
    setActiveWorkspaceId(workspaceId)
    setWorkspaceKey((value) => value + 1)
    notify('success', t('workspace.switched', { name: next?.name ?? workspaceId }))
  }

  const reloadWorkspaces = async () => {
    const next = await fetchWorkspaces()
    setWorkspaces(next)
    if (!next.some((workspace) => workspace.id === currentWorkspaceId())) {
      const fallback = next[0]?.id ?? null
      applyActiveWorkspace(fallback)
      setActiveWorkspaceId(fallback)
      setWorkspaceKey((value) => value + 1)
    }
  }

  const refreshData = async (announce = true) => {
    setDataLoading(true)
    try {
      const [nextOverview, nextServers, nextPlugins, nextDomains, nextLocalUsage] = await Promise.all([fetchOverview(), fetchServers(), fetchPlugins(), fetchDomains(), fetchLocalUsage(range).catch(() => null)])
      setOverview(nextOverview)
      setServers(nextServers)
      setPlugins(nextPlugins)
      setDomains(nextDomains)
      if (nextLocalUsage) setLocalUsage(nextLocalUsage)
      setApiLive(true)
      setDataError(null)
      if (announce) notify('success', t('toast.refreshed'))
    } catch {
      setDataError('toast.dataUnavailable')
      notify('error', t('toast.refreshFailed'))
    } finally {
      setDataLoading(false)
    }
  }

  const refreshUsage = async (announce = true) => {
    setUsageRefreshing(true)
    try {
      const [nextUsage, nextLocalUsage] = await Promise.all([fetchCloudflareUsage(), fetchLocalUsage(range).catch(() => null)])
      setUsage(nextUsage)
      if (nextLocalUsage) setLocalUsage(nextLocalUsage)
      setUsageError(null)
      if (announce) notify('success', t('usage.refreshed'))
    } catch (error) {
      setUsage(null)
      setUsageError(detailedErrorMessage(error, 'toast.usageUnavailable'))
      notify('error', t('usage.refreshFailed'))
    } finally {
      setUsageRefreshing(false)
    }
  }

  return {
    authEnabled, apiConnected, authState, authUser, workspaces, activeWorkspaceId, activeWorkspace, canWrite, isSuperAdmin,
    overview, servers, plugins, domains, audits, accessLogs, usage, localUsage,
    dataLoading, dataError, auditLoading, auditError, accessLogsLoading, accessLogsError, usageLoading, usageRefreshing, usageError,
    platformSettings, setPlatformSettings, cloudflareSettings, setCloudflareSettings, smtpSettings, setSmtpSettings,
    apiLive, range, setRange, switchWorkspace, reloadWorkspaces, refreshData, refreshUsage,
  }
}
