import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { App as AntdApp, ConfigProvider, Dropdown, Select } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import '@ant-design/v5-patch-for-react-19'
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Box,
  Building2,
  Check,
  CircleHelp,
  Command,
  Copy,
  FileText,
  Gauge,
  Globe2,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './styles.css'
import './i18n'
import { createAppTheme, type AppThemeMode } from './app/theme'
import { useToast } from './components/ToastProvider'
import { readCloudflareDiagnosis, type CloudflareDiagnosis } from './features/settings/cloudflare-auth'
import { errorMessage, translateError } from './errors'
import { StatusBadge } from './components/StatusBadge'
import { IconButton } from './components/IconButton'
import { CommandPalette, type CommandItem } from './components/CommandPalette'
import { DocPage } from './components/DocPage'
import { AccountPage } from './features/account/AccountPage'
import { PAGE_PATHS, docFromPath, pageFromPath, type Page } from './app/routes'
import { storeLanguage, type Language } from './i18n'
import { fetchMe, fetchWorkspaces, setActiveWorkspace as applyActiveWorkspace, currentWorkspaceId, type ApiMe, type Workspace } from './api'
import { WorkspacePage } from './features/workspaces/WorkspacePage'
import { OverviewPage } from './features/overview/OverviewPage'
import { ServersPage } from './features/servers/ServersPage'
import { PluginsPage } from './features/plugins/PluginsPage'
import { DomainsPage } from './features/domains/DomainsPage'
import { UsagePage } from './features/usage/UsagePage'
import { AccessLogsPage } from './features/logs/AccessLogsPage'
import { AuditPage } from './features/audit/AuditPage'
import { SettingsPage, settingsSections } from './features/settings/SettingsPage'
import { auditActionLabel } from './lib/audit'
import { downloadCsv } from './lib/csv'
import { formatDateTime } from './lib/format'
import { AuthLoadingScreen, LoginPage } from './features/auth/AuthScreen'
import { assignDomain, checkPluginHealth, commandPlugin, createRegistrationCode, fetchAccessLogs, fetchAudit, fetchCloudflareSettings, fetchCloudflareUsage, fetchDomains, fetchInvites, fetchLocalUsage, fetchOauthSettings, fetchOverview, fetchPlatformSettings, fetchPlugins, fetchPluginDetails, fetchServerDetails, fetchServers, fetchSmtpSettings, syncServer, type ApiAccessLog, type ApiAudit, type ApiDomain, type ApiInvite, type ApiOverview, type ApiPlugin, type ApiPluginDetail, type ApiServer, type ApiServerDetail, type CloudflareSettings, type CloudflareUsage, type LocalUsage, type OauthSettings, type PlatformSettings, type PluginAction, type PluginHealthResult, type SmtpSettings } from './api'

type Theme = 'dark' | 'light' | 'system'
type ModalInput = { prefix?: string; pluginInstanceId?: string }
type ModalResult = { kind: 'registration'; code: string; expiresAt: string } | { kind: 'plugin'; state: string } | { kind: 'domain'; hostname: string }

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

type ConsoleProps = {
  theme: Theme
  setTheme: (theme: Theme) => void
  effectiveTheme: AppThemeMode
  language: Language
}

function Console({ theme, setTheme, effectiveTheme, language }: ConsoleProps) {
  const { t, i18n: translator } = useTranslation()
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('cloudflare')
    const diagnosis = readCloudflareDiagnosis(window.location.search)
    if (result === 'connected') notify('success', t('toast.cloudflareConnected'))
    if (result === 'connected_without_account') notify('info', t('toast.cloudflareConnectedWithoutAccount'))
    if (diagnosis) {
      setCloudflareDiagnosis(diagnosis)
      notify('error', diagnosis.message)
    }
    if (result || diagnosis) window.history.replaceState({}, '', window.location.pathname)
    // 只在首次挂载时读取一次回调参数，避免通知实例变化导致重复弹窗。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const runPluginAction = async (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => {
    if (action === 'unload' && !window.confirm(t('toast.unloadConfirm', { name: plugin.name }))) return
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

  return (
    <div className={`app-shell theme-${effectiveTheme}`}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <Link className="brand-link" to="/" onClick={() => setSidebarOpen(false)}>
            <div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div>
            <div><div className="brand-name">Plugmesh</div><div className="brand-caption">{t('brand.caption')}</div></div>
            <span className="sr-only">{t('shell.home')}</span>
          </Link>
          <IconButton label={t('shell.closeNav')} onClick={() => setSidebarOpen(false)}><X size={17} /></IconButton>
        </div>
        <Dropdown menu={{ items: workspaceMenuItems, onClick: onWorkspaceMenu }} trigger={['click']} placement="bottomLeft">
          <button type="button" className="workspace-switcher">
            <div className="workspace-icon">{(activeWorkspace?.name ?? t('shell.workspace')).trim().slice(0, 1).toUpperCase()}</div>
            <div className="workspace-copy"><strong>{activeWorkspace?.name ?? t('workspace.none')}</strong><span>{activeWorkspace ? `${t(`workspace.roles.${activeWorkspace.role}`)} · ${apiLive ? t('shell.connected') : t('shell.waiting')}` : t('shell.waiting')}</span></div>
            <MoreHorizontal size={16} />
            <span className="sr-only">{t('workspace.switch')}</span>
          </button>
        </Dropdown>
        <nav className="nav-area">
          {navGroups.map((group) => <div className="nav-group" key={group.labelKey}><div className="nav-label">{t(group.labelKey)}</div>{group.items.map(({ id, icon: NavIcon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => selectPage(id)} aria-label={t(`nav.${id}`)}><NavIcon size={16} /><span>{t(`nav.${id}`)}</span>{id === 'servers' && servers && servers.length > 0 && <span className="nav-count">{servers.length}</span>}</button>)}</div>)}
        </nav>
        <div className="sidebar-bottom">
          <Link className="support-link" to="/help" onClick={() => setSidebarOpen(false)}><CircleHelp size={15} /><span>{t('shell.help')}</span><ArrowUpRight size={12} /></Link>
          <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="topLeft">
            <button type="button" className="user-card">
              <div className="avatar">{(authUser?.display_name ?? '—').slice(0, 2).toUpperCase()}</div>
              <div className="user-copy"><strong>{authUser?.display_name ?? t('shell.unknownUser')}</strong><span>{authUser?.email ?? t('shell.unknownIdentity')}</span></div>
              <MoreHorizontal size={16} />
              <span className="sr-only">{t('shell.openUserMenu')}</span>
            </button>
          </Dropdown>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-leading"><IconButton label={t('shell.openNav')} onClick={() => setSidebarOpen(true)}><Menu size={18} /></IconButton><div className="breadcrumbs"><span>{t('shell.console')}</span><span>/</span><strong>{meta.title}</strong></div></div>
          <div className="topbar-actions">
            <button type="button" className="search-box" onClick={() => setPaletteOpen(true)}><Search size={15} /><span className="search-label">{t('shell.search')}</span><span className="shortcut"><Command size={11} /> K</span><span className="sr-only">{t('palette.title')}</span></button>
            <div className="theme-menu"><Sun size={16} aria-hidden="true" /><Select aria-label={t('theme.select')} value={theme} onChange={(value) => setTheme(value)} variant="borderless" popupMatchSelectWidth={false} options={[{ value: 'dark', label: t('theme.dark') }, { value: 'light', label: t('theme.light') }, { value: 'system', label: t('theme.system') }]} /></div>
            <div className="theme-menu language-menu"><Globe2 size={16} aria-hidden="true" /><Select aria-label={t('language.select')} value={language} onChange={(value) => changeLanguage(value)} variant="borderless" popupMatchSelectWidth={false} options={[{ value: 'zh-CN', label: t('language.zh') }, { value: 'en', label: t('language.en') }]} /></div>
            <IconButton label={t('shell.auditEvents')} onClick={() => selectPage('audit')}><Activity size={16} /></IconButton>
            <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="bottomRight">
              <button type="button" className="top-avatar" aria-label={t('shell.currentUser')}>{userInitials}</button>
            </Dropdown>
          </div>
        </header>
        <div className="page-scroll">
          <div className="page-content">
            <div className="page-header"><div><div className="eyebrow"><span className="live-pulse" />{apiLive ? t('shell.live') : t('shell.waitingData')}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="header-actions">{page === 'overview' && <button className="button secondary" onClick={() => void refreshData()} disabled={dataLoading}><RefreshCw size={15} />{t('shell.refresh')}</button>}{page === 'servers' && <button className="button primary" onClick={() => setModal('server')} disabled={!canWrite} title={canWrite ? undefined : t('workspace.readOnlyHint')}><Plus size={16} />{t('shell.bindServer')}</button>}{page === 'domains' && <button className="button primary" onClick={() => setModal('domain')} disabled={!canWrite} title={canWrite ? undefined : t('workspace.readOnlyHint')}><Plus size={16} />{t('shell.assignDomain')}</button>}{page === 'plugins' && <button className="button primary" onClick={() => setModal('plugin')} disabled={!canWrite} title={canWrite ? undefined : t('workspace.readOnlyHint')}><Plus size={16} />{t('shell.loadPlugin')}</button>}</div></div>
            {dataError && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('shell.loadFailed')}</strong><span>{translateError(dataError ?? '')}</span></div><button onClick={() => void refreshData()}>{t('shell.retry')} <RefreshCw size={14} /></button></div>}
            {activeWorkspace && !canWrite && page !== 'settings' && page !== 'workspaces' && <div className="notice-bar compact" role="status"><div className="notice-icon"><ShieldCheck size={16} /></div><div><strong>{t('workspace.readOnly')}</strong><span>{t('workspace.readOnlyHint')}</span></div></div>}
            {page === 'overview' && <OverviewPage overview={overview} usage={usage} localUsage={localUsage} settings={platformSettings} audits={audits ?? []} accessLogs={accessLogs} accessLogsLoading={accessLogsLoading} accessLogsError={accessLogsError} servers={servers ?? []} range={range} setRange={setRange} onNavigate={selectPage} />}
            {page === 'servers' && <ServersPage servers={servers ?? []} loading={dataLoading} onRefresh={() => void refreshData()} onBind={() => setModal('server')} onDetail={(id) => void openDetail('server', id)} />}
            {page === 'plugins' && <PluginsPage plugins={plugins ?? []} loading={dataLoading} onSync={() => void syncManifests()} onLoad={() => setModal('plugin')} onDetail={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} />}
            {page === 'domains' && <DomainsPage domains={domains ?? []} loading={dataLoading} onAction={notify} onRefresh={() => void refreshData()} onAssign={() => setModal('domain')} />}
            {page === 'usage' && <UsagePage settings={platformSettings} usage={usage} localUsage={localUsage} loading={usageLoading} error={usageError} onNavigate={selectPage} />}
            {page === 'logs' && <AccessLogsPage logs={accessLogs ?? []} loading={accessLogsLoading} error={accessLogsError} onExport={exportAccessLogs} />}
            {page === 'audit' && <AuditPage audits={audits ?? []} loading={auditLoading} error={auditError} onExport={exportAudit} />}
            {page === 'workspaces' && <WorkspacePage workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onSwitch={switchWorkspace} onWorkspacesChange={reloadWorkspaces} onAction={notify} />}
            {page === 'settings' && <SettingsPage focusSection={settingsFocus} settings={platformSettings} apiLive={apiLive} isSuperAdmin={isSuperAdmin} canManageInvites={isSuperAdmin || activeWorkspace?.role === 'owner'} activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} onSettingsChange={setPlatformSettings} cloudflareSettings={cloudflareSettings} onCloudflareChange={setCloudflareSettings} cloudflareDiagnosis={cloudflareDiagnosis} onDismissCloudflareDiagnosis={() => setCloudflareDiagnosis(null)} smtpSettings={smtpSettings} onSmtpChange={setSmtpSettings} oauthSettings={oauthSettings} onOauthChange={setOauthSettings} invites={invites} onInvitesChange={setInvites} onAction={notify} />}
            {docPage && (docPage === 'account' ? <AccountPage user={authUser} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} /> : <DocPage page={docPage} />)}
          </div>
        </div>
      </main>
      {modal && <Modal type={modal} plugins={plugins ?? []} onClose={() => setModal(null)} onConfirm={(input) => confirmModal(modal, input)} />}
      {detail && <DetailModal detail={detail} data={detailData} loading={detailLoading} error={detailError} healthLoading={healthPluginId === detail.id} actionLoading={pluginActionLoading?.id === detail.id ? pluginActionLoading.action : null} onClose={() => setDetail(null)} onOpenPlugin={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} onAction={(plugin, action) => void runPluginAction(plugin, action)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} items={paletteItems} />}
    </div>
  )
}

function DetailModal({ detail, data, loading, error, healthLoading, actionLoading, onClose, onOpenPlugin, onHealth, onAction }: { detail: { kind: 'server' | 'plugin'; id: string }; data: { kind: 'server'; value: ApiServerDetail } | { kind: 'plugin'; value: ApiPluginDetail } | null; loading: boolean; error: string | null; healthLoading: boolean; actionLoading: Exclude<PluginAction, 'health'> | null; onClose: () => void; onOpenPlugin: (id: string) => void; onHealth: (plugin: { id: string; name: string }) => void; onAction: (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => void }) {
  const { t } = useTranslation()
  const title = detail.kind === 'server' ? t('detail.serverTitle') : t('detail.pluginTitle')
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal detail-modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2><p>{t('detail.subtitle')}</p></div><IconButton label={t('detail.close')} onClick={onClose}><X size={17} /></IconButton></div>{loading && <div className="detail-loading"><RefreshCw size={18} className="spin" />{t('detail.loading')}</div>}{error && <div className="inline-error"><AlertCircle size={14} />{translateError(error)}</div>}{!loading && !error && data?.kind === 'server' && <ServerDetailContent value={data.value} onOpenPlugin={onOpenPlugin} />}{!loading && !error && data?.kind === 'plugin' && <PluginDetailContent value={data.value} healthLoading={healthLoading} actionLoading={actionLoading} onHealth={onHealth} onAction={onAction} />}</div></div>
}

function ServerDetailContent({ value, onOpenPlugin }: { value: ApiServerDetail; onOpenPlugin: (id: string) => void }) {
  const { t } = useTranslation()
  const { server, plugins, recentErrors } = value
  return <div className="detail-content"><div className="detail-title-row"><div><strong>{server.name}</strong><span>{server.id}</span></div><StatusBadge tone={server.status === 'online' ? 'success' : server.status === 'revoked' ? 'danger' : 'warning'}>{t(`status.${server.status}`, { defaultValue: server.status })}</StatusBadge></div><div className="detail-grid"><DetailValue label={t('detail.server.lastSeen')} value={server.last_seen_at ? formatDateTime(server.last_seen_at) : t('detail.server.never')} /><DetailValue label={t('detail.server.created')} value={formatDateTime(server.created_at)} /><DetailValue label={t('detail.server.pluginCount')} value={String(plugins.length)} /><DetailValue label={t('detail.server.recentErrors')} value={String(recentErrors.length)} /></div><DetailSection title={t('detail.server.plugins')}>{plugins.length === 0 ? <DetailEmpty text={t('detail.server.noPlugins')} /> : <div className="detail-list">{plugins.map((plugin) => <button className="detail-list-row" key={plugin.id} onClick={() => onOpenPlugin(plugin.id)}><span><strong>{plugin.name}</strong><small>{plugin.plugin_id} · v{plugin.version}</small></span><span className="detail-row-meta">{plugin.domain_hostname ?? t('detail.server.noDomain')}<StatusBadge tone={plugin.state === 'enabled' ? 'success' : plugin.state === 'failed' ? 'danger' : 'neutral'}>{t(`status.${plugin.state}`, { defaultValue: plugin.state })}</StatusBadge></span></button>)}</div>}</DetailSection><DetailSection title={t('detail.server.recentErrors')}>{recentErrors.length === 0 ? <DetailEmpty text={t('detail.plugin.noErrors')} /> : <ErrorList errors={recentErrors} />}</DetailSection></div>
}

function PluginDetailContent({ value, healthLoading, actionLoading, onHealth, onAction }: { value: ApiPluginDetail; healthLoading: boolean; actionLoading: Exclude<PluginAction, 'health'> | null; onHealth: (plugin: { id: string; name: string }) => void; onAction: (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => void }) {
  const { t } = useTranslation()
  const { plugin, recentErrors } = value
  let manifest = plugin.manifest_json
  try { manifest = JSON.stringify(JSON.parse(plugin.manifest_json), null, 2) } catch { manifest = plugin.manifest_json }
  const actionButton = (action: Exclude<PluginAction, 'health'>, label: string, icon: React.ReactNode, tone = 'secondary') => <button className={`button ${tone} small`} onClick={() => onAction(plugin, action)} disabled={actionLoading !== null || healthLoading}>{actionLoading === action ? <RefreshCw size={13} className="spin" /> : icon}{actionLoading === action ? t('common.processing') : label}</button>
  return <div className="detail-content"><div className="detail-title-row"><div><strong>{plugin.name}</strong><span>{plugin.plugin_id} · v{plugin.version}</span></div><div className="detail-title-actions">{plugin.state === 'enabled' && <button className="button secondary small" onClick={() => onHealth(plugin)} disabled={healthLoading || actionLoading !== null}>{healthLoading ? <><RefreshCw size={13} className="spin" />{t('pluginCommands.checking')}</> : <><Activity size={13} />{t('pluginCommands.healthCheck')}</>}</button>}{plugin.state === 'discovered' || plugin.state === 'unloaded' || plugin.state === 'failed' ? actionButton('load', t('pluginCommands.load'), <Zap size={13} />, 'primary') : null}{plugin.state === 'loaded' ? actionButton('enable', t('pluginCommands.enable'), <Check size={13} />, 'primary') : null}{plugin.state === 'disabled' ? actionButton('enable', t('pluginCommands.enable'), <Check size={13} />, 'primary') : null}{['loaded', 'enabled', 'disabled'].includes(plugin.state) ? actionButton('unload', t('pluginCommands.unload'), <X size={13} />) : null}{['loaded', 'enabled', 'disabled'].includes(plugin.state) ? actionButton('reload', t('pluginCommands.reload'), <RefreshCw size={13} />) : null}{plugin.state === 'enabled' ? actionButton('disable', t('pluginCommands.disable'), <ShieldCheck size={13} />) : null}<StatusBadge tone={plugin.state === 'enabled' ? 'success' : plugin.state === 'failed' ? 'danger' : 'neutral'}>{t(`status.${plugin.state}`, { defaultValue: plugin.state })}</StatusBadge></div></div><div className="detail-grid"><DetailValue label={t('detail.plugin.server')} value={t('detail.plugin.serverValue', { name: plugin.server_name, status: t(`status.${plugin.server_status}`, { defaultValue: plugin.server_status }) })} /><DetailValue label={t('detail.plugin.desiredState')} value={t(`status.${plugin.desired_state}`, { defaultValue: plugin.desired_state })} /><DetailValue label={t('detail.plugin.domain')} value={plugin.domain_hostname ?? t('common.notAssigned')} /><DetailValue label={t('detail.plugin.recentErrors')} value={String(recentErrors.length)} /></div><DetailSection title={t('detail.plugin.manifest')}><pre className="manifest-block">{manifest}</pre></DetailSection><DetailSection title={t('detail.plugin.recentErrors')}>{recentErrors.length === 0 ? <DetailEmpty text={t('detail.plugin.noErrors')} /> : <ErrorList errors={recentErrors} />}</DetailSection></div>
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section> }
function DetailValue({ label, value }: { label: string; value: string }) { return <div className="detail-value"><span>{label}</span><strong>{value}</strong></div> }
function DetailEmpty({ text }: { text: string }) { return <div className="detail-empty">{text}</div> }
function ErrorList({ errors }: { errors: ApiAccessLog[] }) {
  const { t } = useTranslation()
  return <div className="detail-errors">{errors.map((error) => <div className="detail-error" key={error.id}><div><strong>{error.status} · {error.method}</strong><span>{error.hostname}{error.path}</span></div><time>{formatDateTime(error.created_at)}</time><small>{error.error || t('detail.requestFailed')}</small></div>)}</div>
}

function Modal({ type, plugins, onClose, onConfirm }: { type: 'server' | 'domain' | 'plugin'; plugins: ApiPlugin[]; onClose: () => void; onConfirm: (input: ModalInput) => Promise<ModalResult> }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ModalResult | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  const loadablePlugins = plugins.filter((plugin) => !['loaded', 'enabled'].includes(plugin.state))
  const domainPlugins = plugins.filter((plugin) => plugin.state === 'enabled' && !plugin.domain_hostname)
  const candidates = type === 'plugin' ? loadablePlugins : domainPlugins
  const content = type === 'server'
    ? { title: t('modal.server.title'), description: t('modal.server.description') }
    : type === 'domain'
      ? { title: t('modal.domain.title'), description: t('modal.domain.description') }
      : { title: t('modal.plugin.title'), description: t('modal.plugin.description') }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      setResult(await onConfirm({ prefix: type === 'domain' ? value : undefined, pluginInstanceId: type === 'server' ? undefined : selectedPluginId }))
    } catch (submissionError) {
      setError(errorMessage(submissionError, 'modal.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const copyCode = async (code: string) => {
    if (!navigator.clipboard) {
      setError(t('modal.clipboardUnsupported'))
      return
    }
    try {
      await navigator.clipboard.writeText(code)
      setError(null)
    } catch {
      setError(t('modal.copyFailed'))
    }
  }

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}><div className="modal" role="dialog" aria-modal="true" aria-label={content.title}><div className="modal-head"><div><h2>{content.title}</h2><p>{content.description}</p></div><IconButton label={t('modal.close')} onClick={onClose}><X size={17} /></IconButton></div>{result?.kind === 'registration' && <div className="code-callout"><span>{t('modal.codeExpires', { time: formatDateTime(result.expiresAt) })}</span><div className="code-value"><strong>{result.code}</strong><button className="row-action" onClick={() => void copyCode(result.code)} aria-label={t('modal.copyCode')} title={t('modal.copyCode')}><Copy size={15} /></button></div></div>}{result?.kind === 'plugin' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>{t('modal.loadConfirmed')}</h3><p>{t('modal.loadConfirmedState', { state: result.state })}</p></div>}{result?.kind === 'domain' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>{t('modal.domainAssigned')}</h3><p>{result.hostname}</p></div>}{!result && type === 'server' && <div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>{t('modal.generateCode')}</h3><p>{t('modal.codeHint')}</p></div>}{!result && type !== 'server' && <>{candidates.length > 0 ? <label className="modal-field">{t('modal.pluginInstance')}<Select autoFocus aria-label={t('modal.pluginInstance')} value={selectedPluginId || undefined} onChange={setSelectedPluginId} placeholder={t('modal.selectPlugin')} options={candidates.map((plugin) => ({ value: plugin.id, label: `${plugin.name} · ${plugin.plugin_id} · ${plugin.server_name}` }))} showSearch optionFilterProp="label" style={{ width: '100%' }} /></label> : <div className="empty-panel"><div className="empty-illustration"><AlertCircle size={22} /></div><h3>{type === 'plugin' ? t('modal.noLoadable') : t('modal.noAssignable')}</h3><p>{type === 'plugin' ? t('modal.noLoadableHint') : t('modal.noAssignableHint')}</p></div>}{type === 'domain' && candidates.length > 0 && <label className="modal-field">{t('modal.prefix')}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={t('modal.prefixPlaceholder')} maxLength={48} /><span className="field-hint">{t('modal.prefixHint')}</span></label>}</>}{error && <div className="inline-error"><AlertCircle size={14} />{translateError(error)}</div>}<div className="modal-actions"><button className="button secondary" onClick={onClose} disabled={submitting}>{t('modal.closeAction')}</button>{!result && <button className="button primary" onClick={() => void submit()} disabled={submitting || (type !== 'server' && (!selectedPluginId || candidates.length === 0))}>{submitting ? t('common.submitting') : type === 'server' ? t('modal.submitServer') : type === 'domain' ? t('modal.submitDomain') : t('modal.submitPlugin')}<ArrowUpRight size={14} /></button>}</div></div></div>
}

function Root() {
  const { i18n: translator } = useTranslation()
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem('plugmesh-theme')
    return savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark'
  })
  const [systemTheme, setSystemTheme] = useState<AppThemeMode>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const language: Language = translator.resolvedLanguage === 'en' ? 'en' : 'zh-CN'
  const effectiveTheme: AppThemeMode = theme === 'system' ? systemTheme : theme

  useEffect(() => {
    window.localStorage.setItem('plugmesh-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', effectiveTheme === 'light')
    document.documentElement.style.colorScheme = effectiveTheme
  }, [effectiveTheme])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'light' : 'dark')
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  return <ConfigProvider locale={language === 'en' ? enUS : zhCN} theme={createAppTheme(effectiveTheme)}><AntdApp><Console theme={theme} setTheme={setTheme} effectiveTheme={effectiveTheme} language={language} /></AntdApp></ConfigProvider>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><Root /></BrowserRouter>)
