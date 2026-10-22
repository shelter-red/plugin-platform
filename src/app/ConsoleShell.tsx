import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, App, Avatar, Button, Drawer, Dropdown, Menu, Select, Typography } from 'antd'
import { Activity, ArrowUpRight, Box, Building2, Check, CircleHelp, Command, FileText, Gauge, Globe2, LayoutDashboard, LogOut, Menu as MenuIcon, MoreHorizontal, Network, Plus, RefreshCw, Search, Server, Settings, ShieldCheck, Sun, UserRound, X } from 'lucide-react'
import { type AppThemeMode, type ThemePreference } from '../app/theme'
import { useToast } from '../components/ToastProvider'
import { diagnosisMessageKey, type CloudflareDiagnosis } from '../features/settings/cloudflare-auth'
import { errorMessage, translateError } from '../errors'
import { IconButton } from '../components/IconButton'
import { DetailModal } from '../components/DetailModal'
import { ProvisionModal, type ModalInput, type ModalResult } from '../components/ProvisionModal'
import { CommandPalette, type CommandItem } from '../components/CommandPalette'
import { DocPage } from '../components/DocPage'
import { AccountPage } from '../features/account/AccountPage'
import { PAGE_PATHS, docFromPath, pageFromPath, type Page } from '../app/routes'
import { storeLanguage, type Language } from '../i18n'
import { fetchMe, fetchWorkspaces, setActiveWorkspace as applyActiveWorkspace, currentWorkspaceId, type ApiMe, type Workspace } from '../api'
import { WorkspacePage } from '../features/workspaces/WorkspacePage'
import { OverviewPage } from '../features/overview/OverviewPage'
import { ServersPage } from '../features/servers/ServersPage'
import { PluginsPage } from '../features/plugins/PluginsPage'
import { DomainsPage } from '../features/domains/DomainsPage'
import { UsagePage } from '../features/usage/UsagePage'
import { AccessLogsPage } from '../features/logs/AccessLogsPage'
import { AuditPage } from '../features/audit/AuditPage'
import { SettingsPage, settingsSections } from '../features/settings/SettingsPage'
import { auditActionLabel } from '../lib/audit'
import { downloadCsv } from '../lib/csv'
import { useMediaQuery } from '../lib/useMediaQuery'
import { AuthLoadingScreen, LoginPage } from '../features/auth/AuthScreen'
import { assignDomain, checkPluginHealth, commandPlugin, createRegistrationCode, fetchAccessLogs, fetchAudit, fetchCloudflareAuthResult, fetchCloudflareSettings, fetchCloudflareUsage, fetchDomains, fetchInvites, fetchLocalUsage, fetchOauthSettings, fetchOverview, fetchPlatformSettings, fetchPlugins, fetchPluginDetails, fetchServerDetails, fetchServers, fetchSmtpSettings, syncServer, type ApiAccessLog, type ApiAudit, type ApiDomain, type ApiInvite, type ApiOverview, type ApiPlugin, type ApiPluginDetail, type ApiServer, type ApiServerDetail, type CloudflareSettings, type CloudflareUsage, type LocalUsage, type OauthSettings, type PlatformSettings, type PluginAction, type PluginHealthResult, type SmtpSettings } from '../api'

const navGroups: { labelKey: string; items: { id: Page; icon: typeof LayoutDashboard }[] }[] = [
  {
    labelKey: 'nav.groups.main',
    items: [
      { id: 'overview', icon: LayoutDashboard },
      { id: 'servers', icon: Server },
      { id: 'plugins', icon: Box },
      { id: 'domains', icon: Globe2 },
      { id: 'workspaces', icon: Building2 },
    ],
  },
  {
    labelKey: 'nav.groups.system',
    items: [
      { id: 'usage', icon: Gauge },
      { id: 'logs', icon: Activity },
      { id: 'audit', icon: FileText },
      { id: 'settings', icon: Settings },
    ],
  },
]

export type ConsoleProps = {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  effectiveTheme: AppThemeMode
  language: Language
}

export function ConsoleShell({ theme, setTheme, effectiveTheme, language }: ConsoleProps) {
  const { t, i18n: translator } = useTranslation()
  const modalApi = App.useApp().modal
  // ≤1000px 侧栏收成图标条，≤760px 改用抽屉展示，两处都需要改变结构而不只是样式。
  const compactNav = useMediaQuery('(max-width: 1000px)')
  const mobileNav = useMediaQuery('(max-width: 760px)')
  const location = useLocation()
  const navigate = useNavigate()
  const page = pageFromPath(location.pathname)
  const docPage = docFromPath(location.pathname)
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== 'false'
  // 纯静态预览（无鉴权且未配置 API 地址）不发起任何 Worker 请求，保持空态展示。
  const apiConnected = authEnabled || Boolean(import.meta.env.VITE_API_BASE)
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'anonymous'>(authEnabled ? 'loading' : 'authenticated')
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
  const [invites, setInvites] = useState<ApiInvite[] | null>(null)
  const [usage, setUsage] = useState<CloudflareUsage | null>(null)
  const [localUsage, setLocalUsage] = useState<LocalUsage | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [accessLogsError, setAccessLogsError] = useState<string | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [accessLogsLoading, setAccessLogsLoading] = useState(false)
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null)
  const [cloudflareSettings, setCloudflareSettings] = useState<CloudflareSettings | null>(null)
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null)
  const [oauthSettings, setOauthSettings] = useState<OauthSettings | null>(null)
  const [cloudflareDiagnosis, setCloudflareDiagnosis] = useState<CloudflareDiagnosis | null>(null)
  const [apiLive, setApiLive] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsFocus, setSettingsFocus] = useState<{ section: string; nonce: number } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modal, setModal] = useState<'server' | 'domain' | 'plugin' | null>(null)
  const [detail, setDetail] = useState<{ kind: 'server' | 'plugin'; id: string } | null>(null)
  const [detailData, setDetailData] = useState<{ kind: 'server'; value: ApiServerDetail } | { kind: 'plugin'; value: ApiPluginDetail } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [healthPluginId, setHealthPluginId] = useState<string | null>(null)
  const [pluginActionLoading, setPluginActionLoading] = useState<{ id: string; action: Exclude<PluginAction, 'health'> } | null>(null)
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d')

  const meta = page
    ? { title: t(`pages.${page}.title`), description: t(`pages.${page}.description`) }
    : docPage
      ? { title: t(`docs.${docPage}.title`), description: t(`docs.${docPage}.description`) }
      : { title: t('nav.overview'), description: '' }
  const changeLanguage = (next: Language) => {
    storeLanguage(next)
    void translator.changeLanguage(next)
  }
  useEffect(() => {
    document.title = `${meta.title} · Plugmesh`
  }, [meta.title])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const userInitials = (authUser?.display_name ?? authUser?.email ?? '—').trim().slice(0, 2).toUpperCase()
  const userMenuItems = [
    { key: 'account', label: t('account.title'), icon: <UserRound size={14} /> },
    { key: 'help', label: t('docs.help.title'), icon: <CircleHelp size={14} /> },
    { type: 'divider' as const },
    { key: 'logout', label: t('account.logout'), icon: <LogOut size={14} />, danger: true },
  ]
  const onUserMenu = ({ key }: { key: string }) => {
    if (key === 'logout') window.location.assign('/auth/logout')
    if (key === 'account') navigate('/account')
    if (key === 'help') navigate('/help')
  }
  const workspaceMenuItems = [
    ...workspaces.map((workspace) => ({ key: `ws:${workspace.id}`, label: `${workspace.name} · ${t(`workspace.roles.${workspace.role}`)}`, icon: workspace.id === activeWorkspaceId ? <Check size={14} /> : <Building2 size={14} /> })),
    ...(workspaces.length > 0 ? [{ type: 'divider' as const }] : []),
    { key: 'workspace:manage', label: t('workspace.manage'), icon: <Building2 size={14} /> },
    { key: 'workspace:create', label: t('workspace.create'), icon: <Plus size={14} /> },
  ]
  const onWorkspaceMenu = ({ key }: { key: string }) => {
    if (key.startsWith('ws:')) switchWorkspace(key.slice(3))
    else if (key === 'workspace:manage' || key === 'workspace:create') navigate('/workspaces')
  }

  const navItems = navGroups.map((group) => ({
    type: 'group' as const,
    key: group.labelKey,
    label: t(group.labelKey),
    children: group.items.map(({ id, icon: NavIcon }) => ({
      key: id,
      icon: <NavIcon size={16} />,
      label: t(`nav.${id}`),
      extra: id === 'servers' && servers && servers.length > 0 ? <span className="nav-count">{servers.length}</span> : undefined,
    })),
  }))

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
      .catch(() => {
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
    fetchOauthSettings().then(setOauthSettings).catch(() => setOauthSettings(null))
  }, [authEnabled])

  // Cloudflare 授权回跳结果经一次性 Cookie 回传：成功后刷新凭据状态，失败则回到
  // 系统设置 → Cloudflare 面板展示诊断，而不是把用户丢在首页。
  useEffect(() => {
    // 鉴权关闭但仍有 API 时同样读回一次性结果（本地/冒烟环境），避免只有生产鉴权路径生效。
    if (!apiConnected || authState !== 'authenticated' || authUser?.role !== 'super_admin') return
    let cancelled = false
    fetchCloudflareAuthResult().then((result) => {
      if (cancelled || !result) return
      if (result.kind === 'success') {
        fetchCloudflareSettings().then(setCloudflareSettings).catch(() => setCloudflareSettings(null))
        if (result.accountConfigured) return notify('success', t('toast.cloudflareConnected'))
        // 未识别账号由面板里的缺少权限警告承载，避免同时出现两条重复诊断。
        openSettingsSection('cloudflare')
        return notify('warning', t('settings.cloudflare.diagnosis.account_missing'))
      }
      setCloudflareDiagnosis({ code: result.code, description: result.description })
      openSettingsSection('cloudflare')
      notify('error', t(diagnosisMessageKey(result.code)))
    }).catch(() => undefined)
    return () => { cancelled = true }
    // 仅在登录态确定后读取一次；openSettingsSection/notify 只改写页面状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiConnected, authState, authUser?.role])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchPlatformSettings().then(setPlatformSettings).catch(() => setPlatformSettings(null))
  }, [authEnabled])

  useEffect(() => {
    if (!apiConnected || !workspaceReady) return
    if (authUser?.role !== 'super_admin' && activeWorkspace?.role !== 'owner') {
      setInvites(null)
      return
    }
    fetchInvites().then(setInvites).catch(() => setInvites(null))
  }, [authUser?.role, activeWorkspace?.role, workspaceReady, workspaceKey])

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
      setUsageError(errorMessage(error, 'toast.usageUnavailable'))
    }).finally(() => setUsageLoading(false))
  }, [workspaceReady, workspaceKey])

  useEffect(() => {
    if (!apiConnected || !workspaceReady) return
    fetchLocalUsage(range).then(setLocalUsage).catch(() => setLocalUsage(null))
  }, [workspaceReady, workspaceKey, range])

  const notify = useToast()

  const switchWorkspace = (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) return
    // 新建或删除后列表尚未重新渲染，此时也应立即切换，名称回退到列表中的最新值。
    const next = workspaces.find((workspace) => workspace.id === workspaceId)
    applyActiveWorkspace(workspaceId)
    setActiveWorkspaceId(workspaceId)
    setWorkspaceKey((value) => value + 1)
    setDetail(null)
    setModal(null)
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
    setUsageLoading(true)
    try {
      const [nextUsage, nextLocalUsage] = await Promise.all([fetchCloudflareUsage(), fetchLocalUsage(range).catch(() => null)])
      setUsage(nextUsage)
      if (nextLocalUsage) setLocalUsage(nextLocalUsage)
      setUsageError(null)
      if (announce) notify('success', t('usage.refreshed'))
    } catch (error) {
      setUsage(null)
      setUsageError(errorMessage(error, 'toast.usageUnavailable'))
      notify('error', t('usage.refreshFailed'))
    } finally {
      setUsageLoading(false)
    }
  }

  const confirmModal = async (type: 'server' | 'domain' | 'plugin', input: ModalInput): Promise<ModalResult> => {
    if (type === 'server') {
      const result = await createRegistrationCode()
      await refreshData(false)
      return { kind: 'registration', code: result.code, expiresAt: result.expiresAt }
    }
    if (!input.pluginInstanceId) throw new Error('toast.selectPlugin')
    if (type === 'plugin') {
      const result = await commandPlugin(input.pluginInstanceId, 'load')
      await refreshData(false)
      return { kind: 'plugin', state: result.state }
    }
    if (!input.prefix?.trim()) throw new Error('toast.prefixRequired')
    const result = await assignDomain(input.pluginInstanceId, input.prefix.trim())
    await refreshData(false)
    return { kind: 'domain', hostname: result.hostname }
  }

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

  const runHealthCheck = async (plugin: ApiPlugin | { id: string; name: string }) => {
    setHealthPluginId(plugin.id)
    try {
      const result: PluginHealthResult = await checkPluginHealth(plugin.id)
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

  const syncManifests = async () => {
    const onlineServerIds = [...new Set((servers ?? []).filter((server) => server.status === 'online').map((server) => server.id))]
    if (onlineServerIds.length === 0) {
      notify('warning', t('toast.noOnlineServers'))
      return
    }
    try {
      await Promise.all(onlineServerIds.map((serverId) => syncServer(serverId)))
      notify('success', t('toast.syncRequested', { count: onlineServerIds.length }))
      window.setTimeout(() => void refreshData(false), 500)
    } catch (error) {
      notify('error', errorMessage(error, 'toast.syncFailed'))
    }
  }

  const selectPage = (next: Page) => {
    if (next === 'settings') setSettingsFocus(null)
    navigate(PAGE_PATHS[next])
    setSidebarOpen(false)
  }

  const openSettingsSection = (section: string) => {
    navigate(PAGE_PATHS.settings)
    setSidebarOpen(false)
    setSettingsFocus({ section, nonce: Date.now() })
  }

  const paletteItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []
    for (const group of navGroups) {
      for (const { id } of group.items) {
        items.push({ id: `page:${id}`, group: t('palette.group.pages'), label: t(`nav.${id}`), run: () => selectPage(id) })
      }
    }
    for (const { id, labelKey } of settingsSections) {
      items.push({ id: `settings:${id}`, group: t('palette.group.settings'), label: t(labelKey), run: () => openSettingsSection(id) })
    }
    for (const server of servers ?? []) {
      items.push({ id: `server:${server.id}`, group: t('nav.servers'), label: server.name, hint: t(`status.${server.status}`, { defaultValue: server.status }), run: () => selectPage('servers') })
    }
    for (const plugin of plugins ?? []) {
      items.push({ id: `plugin:${plugin.id}`, group: t('nav.plugins'), label: plugin.name, hint: `${plugin.plugin_id} · ${plugin.server_name}`, run: () => selectPage('plugins') })
    }
    for (const domain of domains ?? []) {
      items.push({ id: `domain:${domain.id}`, group: t('nav.domains'), label: domain.hostname, hint: domain.plugin_name, run: () => selectPage('domains') })
    }
    for (const log of (accessLogs ?? []).slice(0, 30)) {
      items.push({ id: `log:${log.id}`, group: t('nav.logs'), label: `${log.hostname}${log.path}`, hint: `${log.method} · ${log.status}`, run: () => selectPage('logs') })
    }
    for (const audit of (audits ?? []).slice(0, 30)) {
      items.push({ id: `audit:${audit.id}`, group: t('nav.audit'), label: auditActionLabel(audit.action), hint: audit.actor_name ?? t('audit.systemEvent'), run: () => selectPage('audit') })
    }
    return items
    // selectPage/openSettingsSection 只改写页面状态，依赖下列数据即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessLogs, audits, domains, plugins, servers, t])

  const exportAccessLogs = () => {
    const rows = accessLogs ?? []
    if (rows.length === 0) return notify('info', t('toast.noAccessLogs'))
    downloadCsv(`plugmesh-access-logs-${new Date().toISOString().slice(0, 10)}.csv`, [t('csv.accessLogs.hostname'), t('csv.accessLogs.method'), t('csv.accessLogs.path'), t('csv.accessLogs.status'), t('csv.accessLogs.duration'), t('csv.accessLogs.error'), t('csv.accessLogs.createdAt')], rows.map((log) => [log.hostname, log.method, log.path, log.status, log.duration_ms, log.error, log.created_at]))
    notify('success', t('toast.accessLogsExported', { count: rows.length }))
  }

  const exportAudit = () => {
    const rows = audits ?? []
    if (rows.length === 0) return notify('info', t('toast.noAudit'))
    downloadCsv(`plugmesh-audit-${new Date().toISOString().slice(0, 10)}.csv`, [t('csv.audit.action'), t('csv.audit.detail'), t('csv.audit.actor'), t('csv.audit.actorEmail'), t('csv.audit.createdAt')], rows.map((item) => [item.action, item.detail_json, item.actor_name, item.actor_email, item.created_at]))
    notify('success', t('toast.auditExported', { count: rows.length }))
  }

  if (authEnabled && authState === 'loading') return <AuthLoadingScreen mode={effectiveTheme} />
  if (authEnabled && authState === 'anonymous') return <LoginPage mode={effectiveTheme} />
  if (!page && !docPage) return <Navigate to="/" replace />

  const sidebar = (
    <aside className="sidebar">
      <div className="brand-row">
        <Link className="brand-link" to="/" onClick={() => setSidebarOpen(false)}>
          <Avatar shape="square" size={30} className="brand-mark" icon={<Network size={17} strokeWidth={2.4} />} />
          <div>
            <Typography.Text strong className="brand-name">Plugmesh</Typography.Text>
            <Typography.Text className="brand-caption">{t('brand.caption')}</Typography.Text>
          </div>
          <span className="sr-only">{t('shell.home')}</span>
        </Link>
        <IconButton label={t('shell.closeNav')} onClick={() => setSidebarOpen(false)}><X size={17} /></IconButton>
      </div>
      <Dropdown menu={{ items: workspaceMenuItems, onClick: onWorkspaceMenu }} trigger={['click']} placement="bottomLeft">
        <Button type="text" block className="workspace-switcher">
          <Avatar shape="square" size={24} className="workspace-icon">{(activeWorkspace?.name ?? t('shell.workspace')).trim().slice(0, 1).toUpperCase()}</Avatar>
          <span className="workspace-copy"><strong>{activeWorkspace?.name ?? t('workspace.none')}</strong><span>{activeWorkspace ? `${t(`workspace.roles.${activeWorkspace.role}`)} · ${apiLive ? t('shell.connected') : t('shell.waiting')}` : t('shell.waiting')}</span></span>
          <MoreHorizontal size={16} />
          <span className="sr-only">{t('workspace.switch')}</span>
        </Button>
      </Dropdown>
      <nav className="nav-area" aria-label={t('shell.navigation')}>
        <Menu mode="inline" inlineCollapsed={compactNav && !mobileNav} className="nav-menu" items={navItems} selectedKeys={page ? [page] : []} onClick={({ key }) => selectPage(key as Page)} />
      </nav>
      <div className="sidebar-bottom">
        <Link className="support-link" to="/help" onClick={() => setSidebarOpen(false)}><CircleHelp size={15} /><span>{t('shell.help')}</span><ArrowUpRight size={12} /></Link>
        <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="topLeft">
          <Button type="text" block className="user-card">
            <Avatar size={26} className="avatar">{(authUser?.display_name ?? '—').slice(0, 2).toUpperCase()}</Avatar>
            <span className="user-copy"><strong>{authUser?.display_name ?? t('shell.unknownUser')}</strong><span>{authUser?.email ?? t('shell.unknownIdentity')}</span></span>
            <MoreHorizontal size={16} />
            <span className="sr-only">{t('shell.openUserMenu')}</span>
          </Button>
        </Dropdown>
      </div>
    </aside>
  )

  return (
    <div className={`app-shell theme-${effectiveTheme}`}>
      {mobileNav ? (
        <Drawer
          rootClassName={`nav-drawer theme-${effectiveTheme}`}
          placement="left"
          width={236}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          {sidebar}
        </Drawer>
      ) : sidebar}

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-leading"><IconButton label={t('shell.openNav')} onClick={() => setSidebarOpen(true)}><MenuIcon size={18} /></IconButton><div className="breadcrumbs"><span>{t('shell.console')}</span><span>/</span><strong>{meta.title}</strong></div></div>
          <div className="topbar-actions">
            <Button type="text" className="search-box" onClick={() => setPaletteOpen(true)} icon={<Search size={15} />}><span className="search-label">{t('shell.search')}</span><span className="shortcut"><Command size={11} /> K</span><span className="sr-only">{t('palette.title')}</span></Button>
            <div className="theme-menu"><Sun size={16} aria-hidden="true" /><Select aria-label={t('theme.select')} value={theme} onChange={(value) => setTheme(value)} variant="borderless" popupMatchSelectWidth={false} options={[{ value: 'dark', label: t('theme.dark') }, { value: 'light', label: t('theme.light') }, { value: 'system', label: t('theme.system') }]} /></div>
            <div className="theme-menu language-menu"><Globe2 size={16} aria-hidden="true" /><Select aria-label={t('language.select')} value={language} onChange={(value) => changeLanguage(value)} variant="borderless" popupMatchSelectWidth={false} options={[{ value: 'zh-CN', label: t('language.zh') }, { value: 'en', label: t('language.en') }]} /></div>
            <IconButton label={t('shell.auditEvents')} onClick={() => selectPage('audit')}><Activity size={16} /></IconButton>
            <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="bottomRight">
              <Button type="text" shape="circle" className="top-avatar" aria-label={t('shell.currentUser')}>{userInitials}</Button>
            </Dropdown>
          </div>
        </header>
        <div className="page-scroll">
          <div className="page-content">
            <div className="page-header">
              <div>
                <div className="eyebrow"><span className="live-pulse" />{apiLive ? t('shell.live') : t('shell.waitingData')}</div>
                <Typography.Title level={1}>{meta.title}</Typography.Title>
                <Typography.Paragraph type="secondary">{meta.description}</Typography.Paragraph>
              </div>
              <div className="header-actions">
                {page === 'overview' && <Button icon={<RefreshCw size={15} />} onClick={() => void refreshData()} disabled={dataLoading}>{t('shell.refresh')}</Button>}
                {page === 'usage' && <Button icon={<RefreshCw size={15} />} onClick={() => void refreshUsage()} loading={usageLoading}>{t('usage.refresh')}</Button>}
                {page === 'servers' && <Button type="primary" icon={<Plus size={16} />} onClick={() => setModal('server')} disabled={!canWrite} title={canWrite ? undefined : t('workspace.readOnlyHint')}>{t('shell.bindServer')}</Button>}
                {page === 'domains' && <Button type="primary" icon={<Plus size={16} />} onClick={() => setModal('domain')} disabled={!canWrite} title={canWrite ? undefined : t('workspace.readOnlyHint')}>{t('shell.assignDomain')}</Button>}
                {page === 'plugins' && <Button type="primary" icon={<Plus size={16} />} onClick={() => setModal('plugin')} disabled={!canWrite} title={canWrite ? undefined : t('workspace.readOnlyHint')}>{t('shell.loadPlugin')}</Button>}
              </div>
            </div>
            {dataError && <Alert className="page-alert" type="error" showIcon message={t('shell.loadFailed')} description={translateError(dataError)} action={<Button size="small" type="link" onClick={() => void refreshData()}>{t('shell.retry')}</Button>} />}
            {activeWorkspace && !canWrite && page !== 'settings' && page !== 'workspaces' && <Alert className="page-alert" type="info" showIcon icon={<ShieldCheck size={16} />} message={t('workspace.readOnly')} description={t('workspace.readOnlyHint')} />}
            {page === 'overview' && <OverviewPage overview={overview} usage={usage} localUsage={localUsage} settings={platformSettings} audits={audits ?? []} accessLogs={accessLogs} accessLogsLoading={accessLogsLoading} accessLogsError={accessLogsError} servers={servers ?? []} range={range} setRange={setRange} onNavigate={selectPage} />}
            {page === 'servers' && <ServersPage servers={servers ?? []} loading={dataLoading} onRefresh={() => void refreshData()} onBind={() => setModal('server')} onDetail={(id) => void openDetail('server', id)} />}
            {page === 'plugins' && <PluginsPage plugins={plugins ?? []} loading={dataLoading} onSync={() => void syncManifests()} onLoad={() => setModal('plugin')} onDetail={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} />}
            {page === 'domains' && <DomainsPage domains={domains ?? []} loading={dataLoading} onAction={notify} onRefresh={() => void refreshData()} onAssign={() => setModal('domain')} />}
            {page === 'usage' && <UsagePage settings={platformSettings} usage={usage} localUsage={localUsage} loading={usageLoading} error={usageError} onRefresh={() => void refreshUsage()} onOpenCloudflareSettings={() => openSettingsSection('cloudflare')} />}
            {page === 'logs' && <AccessLogsPage logs={accessLogs ?? []} loading={accessLogsLoading} error={accessLogsError} onExport={exportAccessLogs} />}
            {page === 'audit' && <AuditPage audits={audits ?? []} loading={auditLoading} error={auditError} onExport={exportAudit} />}
            {page === 'workspaces' && <WorkspacePage workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onSwitch={switchWorkspace} onWorkspacesChange={reloadWorkspaces} onAction={notify} />}
            {page === 'settings' && <SettingsPage focusSection={settingsFocus} settings={platformSettings} apiLive={apiLive} isSuperAdmin={isSuperAdmin} canManageInvites={isSuperAdmin || activeWorkspace?.role === 'owner'} activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} onSettingsChange={setPlatformSettings} cloudflareSettings={cloudflareSettings} onCloudflareChange={setCloudflareSettings} cloudflareDiagnosis={cloudflareDiagnosis} onDismissCloudflareDiagnosis={() => setCloudflareDiagnosis(null)} smtpSettings={smtpSettings} onSmtpChange={setSmtpSettings} oauthSettings={oauthSettings} onOauthChange={setOauthSettings} invites={invites} onInvitesChange={setInvites} onAction={notify} />}
            {docPage && (docPage === 'account' ? <AccountPage user={authUser} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} /> : <DocPage page={docPage} />)}
          </div>
        </div>
      </main>
      {modal && <ProvisionModal type={modal} plugins={plugins ?? []} onClose={() => setModal(null)} onConfirm={(input) => confirmModal(modal, input)} />}
      {detail && <DetailModal detail={detail} data={detailData} loading={detailLoading} error={detailError} healthLoading={healthPluginId === detail.id} actionLoading={pluginActionLoading?.id === detail.id ? pluginActionLoading.action : null} onClose={() => setDetail(null)} onOpenPlugin={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} onAction={(plugin, action) => void runPluginAction(plugin, action)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} items={paletteItems} />}
    </div>
  )
}
