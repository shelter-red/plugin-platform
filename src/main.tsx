import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Code2,
  Command,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Mail,
  Gauge,
  Globe2,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  ListFilter,
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
  Users,
  X,
  Zap,
} from 'lucide-react'
import './styles.css'
import './i18n'
import i18n, { storeLanguage, type Language } from './i18n'
import { ApiError, assignDomain, checkPluginHealth, commandPlugin, createInvite, createRegistrationCode, fetchAccessLogs, fetchAudit, fetchCloudflareSettings, fetchCloudflareUsage, fetchDomains, fetchInvites, fetchLocalUsage, fetchOauthSettings, fetchOverview, fetchPlatformSettings, fetchPlugins, fetchPluginDetails, fetchServerDetails, fetchServers, fetchSmtpSettings, revokeCloudflareSettings, revokeInvite, revokeOauthSettings, syncServer, type ApiAccessLog, type ApiAudit, type ApiDomain, type ApiInvite, type ApiOverview, type ApiPlugin, type ApiPluginDetail, type ApiServer, type ApiServerDetail, type CloudflareSettings, type CloudflareUsage, type LocalUsage, type OauthProvider, type OauthSettings, type PlatformSettings, type PluginAction, type PluginHealthResult, type SmtpSettings, type UsageBreakdownEntry, type UsageSnapshot, sendSmtpTest, updateOauthSettings, updatePlatformSettings, updateSmtpSettings } from './api'

type Page = 'overview' | 'servers' | 'plugins' | 'domains' | 'usage' | 'logs' | 'audit' | 'settings'
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

const currentLocale = () => i18n.resolvedLanguage ?? 'zh-CN'
const formatDateTime = (value: string) => new Date(value).toLocaleString(currentLocale())
const formatNumber = (value: number) => value.toLocaleString(currentLocale())
const translateError = (value: string) => i18n.exists(value) ? i18n.t(value) : value

const httpErrorKey = (status: number) => {
  if (status === 401) return 'toast.http.unauthorized'
  if (status === 403) return 'toast.http.forbidden'
  if (status === 404) return 'toast.http.notFound'
  if (status === 409) return 'toast.http.conflict'
  if (status === 429) return 'toast.http.rateLimited'
  if (status >= 500) return 'toast.http.serverError'
  return 'toast.http.failed'
}

// Worker 的错误文本是面向开发的英文；除非服务端已给出中文提示，否则统一换成按状态码本地化的文案。
function errorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError) {
    if (/[\u4e00-\u9fa5]/.test(error.message)) return error.message
    return i18n.t(httpErrorKey(error.status))
  }
  if (error instanceof Error && i18n.exists(error.message)) return i18n.t(error.message)
  return i18n.t(fallbackKey)
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function AuthLoading() {
  const { t } = useTranslation()
  return <div className="auth-screen"><div className="auth-card"><div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div><h1>{t('auth.checkingTitle')}</h1><p>{t('auth.checkingBody')}</p><div className="loading-line" /></div></div>
}

function LoginPage() {
  const { t } = useTranslation()
  const invite = new URLSearchParams(window.location.search).get('invite')
  const authError = new URLSearchParams(window.location.search).get('auth_error')
  const startUrl = `/auth/github/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div><div><strong>Plugmesh</strong><span>{t('brand.caption')}</span></div></div><div className="auth-icon"><Code2 size={22} /></div><h1>{invite ? t('auth.inviteTitle') : t('auth.loginTitle')}</h1><p>{invite ? t('auth.inviteBody') : t('auth.loginBody')}</p>{authError && <div className="auth-error"><AlertCircle size={14} />{authError}</div>}<a className="github-button" href={startUrl}><GithubMark size={16} />{t('auth.github')}<ArrowUpRight size={14} /></a><span className="auth-note"><LockKeyhole size={13} />{t('auth.note')}</span></div></div>
}

function StatusBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  return <span className={`status-badge ${tone}`}><span className="status-dot" />{children}</span>
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null>>) {
  const escape = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function App() {
  const { t, i18n: translator } = useTranslation()
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== 'false'
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'anonymous'>(authEnabled ? 'loading' : 'authenticated')
  const [authUser, setAuthUser] = useState<{ display_name: string; email: string; role?: string } | null>(null)
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
  const [apiLive, setApiLive] = useState(false)
  const [page, setPage] = useState<Page>('overview')
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem('plugmesh-theme')
    return savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark'
  })
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modal, setModal] = useState<'server' | 'domain' | 'plugin' | null>(null)
  const [detail, setDetail] = useState<{ kind: 'server' | 'plugin'; id: string } | null>(null)
  const [detailData, setDetailData] = useState<{ kind: 'server'; value: ApiServerDetail } | { kind: 'plugin'; value: ApiPluginDetail } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [healthPluginId, setHealthPluginId] = useState<string | null>(null)
  const [pluginActionLoading, setPluginActionLoading] = useState<{ id: string; action: Exclude<PluginAction, 'health'> } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d')

  const meta = { title: t(`pages.${page}.title`), description: t(`pages.${page}.description`) }
  const language: Language = translator.resolvedLanguage === 'en' ? 'en' : 'zh-CN'
  const changeLanguage = (next: Language) => {
    storeLanguage(next)
    void translator.changeLanguage(next)
  }
  const themeLabel = t(`theme.${theme}`)
  useEffect(() => {
    document.title = `${meta.title} · Plugmesh`
  }, [meta.title])
  const effectiveTheme = theme === 'system' ? systemTheme : theme
  const userInitials = (authUser?.display_name ?? authUser?.email ?? '—').trim().slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!authEnabled) return
    fetch('/api/me', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('anonymous')
        const data = await response.json() as { user?: { display_name: string; email: string; role?: string } }
        setAuthUser(data.user ?? null)
        setAuthState('authenticated')
      })
      .catch(() => setAuthState('anonymous'))
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
    const error = params.get('cloudflare_error')
    if (result === 'connected') setToast(t('toast.cloudflareConnected'))
    if (result === 'connected_without_account') setToast(t('toast.cloudflareConnectedWithoutAccount'))
    if (error) setToast(error)
    if (result || error) window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`)
  }, [])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchPlatformSettings().then(setPlatformSettings).catch(() => setPlatformSettings(null))
  }, [authEnabled])

  useEffect(() => {
    if (authUser?.role !== 'super_admin') return
    fetchInvites().then(setInvites).catch(() => setInvites(null))
  }, [authUser?.role])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchOverview().then((data) => {
      setOverview(data)
      setApiLive(true)
    }).catch(() => setApiLive(false))
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    setDataLoading(true)
    Promise.all([fetchServers(), fetchPlugins(), fetchDomains()]).then(([nextServers, nextPlugins, nextDomains]) => {
      setServers(nextServers)
      setPlugins(nextPlugins)
      setDomains(nextDomains)
      setDataError(null)
    }).catch(() => setDataError('toast.dataUnavailable')).finally(() => setDataLoading(false))
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
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
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    fetchLocalUsage(range).then(setLocalUsage).catch(() => setLocalUsage(null))
  }, [authEnabled, range])

  useEffect(() => {
    window.localStorage.setItem('plugmesh-theme', theme)
  }, [theme])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'light' : 'dark')
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const refreshData = async (notify = true) => {
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
      if (notify) showToast(t('toast.refreshed'))
    } catch {
      setDataError('toast.dataUnavailable')
      showToast(t('toast.refreshFailed'))
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
      showToast(t('toast.healthOk', { name: plugin.name, status: result.status, bodySize: result.bodySize }))
      await refreshData(false)
      if (detail?.kind === 'plugin' && detail.id === plugin.id) void openDetail('plugin', plugin.id)
    } catch (error) {
      showToast(errorMessage(error, 'toast.healthFailed'))
    } finally {
      setHealthPluginId(null)
    }
  }

  const runPluginAction = async (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => {
    if (action === 'unload' && !window.confirm(t('toast.unloadConfirm', { name: plugin.name }))) return
    setPluginActionLoading({ id: plugin.id, action })
    try {
      await commandPlugin(plugin.id, action)
      showToast(t('toast.actionDone', { name: plugin.name, action: t(`pluginActionPast.${action}`) }))
      await refreshData(false)
      if (detail?.kind === 'plugin' && detail.id === plugin.id) void openDetail('plugin', plugin.id)
    } catch (error) {
      showToast(errorMessage(error, 'toast.actionFailed'))
    } finally {
      setPluginActionLoading(null)
    }
  }

  const syncManifests = async () => {
    const onlineServerIds = [...new Set((servers ?? []).filter((server) => server.status === 'online').map((server) => server.id))]
    if (onlineServerIds.length === 0) {
      showToast(t('toast.noOnlineServers'))
      return
    }
    try {
      await Promise.all(onlineServerIds.map((serverId) => syncServer(serverId)))
      showToast(t('toast.syncRequested', { count: onlineServerIds.length }))
      window.setTimeout(() => void refreshData(false), 500)
    } catch (error) {
      showToast(errorMessage(error, 'toast.syncFailed'))
    }
  }

  const filteredPlugins = useMemo(() => {
    const current = plugins ?? []
    if (!search.trim()) return current
    const q = search.toLowerCase()
    return current.filter((plugin) => `${plugin.name} ${plugin.plugin_id} ${plugin.domain_hostname ?? ''}`.toLowerCase().includes(q))
  }, [plugins, search])

  const selectPage = (next: Page) => {
    setPage(next)
    setSidebarOpen(false)
  }

  const exportAccessLogs = () => {
    const rows = accessLogs ?? []
    if (rows.length === 0) return showToast(t('toast.noAccessLogs'))
    downloadCsv(`plugmesh-access-logs-${new Date().toISOString().slice(0, 10)}.csv`, [t('csv.accessLogs.hostname'), t('csv.accessLogs.method'), t('csv.accessLogs.path'), t('csv.accessLogs.status'), t('csv.accessLogs.duration'), t('csv.accessLogs.error'), t('csv.accessLogs.createdAt')], rows.map((log) => [log.hostname, log.method, log.path, log.status, log.duration_ms, log.error, log.created_at]))
    showToast(t('toast.accessLogsExported', { count: rows.length }))
  }

  const exportAudit = () => {
    const rows = audits ?? []
    if (rows.length === 0) return showToast(t('toast.noAudit'))
    downloadCsv(`plugmesh-audit-${new Date().toISOString().slice(0, 10)}.csv`, [t('csv.audit.action'), t('csv.audit.detail'), t('csv.audit.actor'), t('csv.audit.actorEmail'), t('csv.audit.createdAt')], rows.map((item) => [item.action, item.detail_json, item.actor_name, item.actor_email, item.created_at]))
    showToast(t('toast.auditExported', { count: rows.length }))
  }

  if (authEnabled && authState === 'loading') return <AuthLoading />
  if (authEnabled && authState === 'anonymous') return <LoginPage />

  return (
    <div className={`app-shell theme-${effectiveTheme}`}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div>
          <div><div className="brand-name">Plugmesh</div><div className="brand-caption">{t('brand.caption')}</div></div>
          <IconButton label={t('shell.closeNav')} onClick={() => setSidebarOpen(false)}><X size={17} /></IconButton>
        </div>
        <div className="workspace-switcher"><div className="workspace-icon">P</div><div className="workspace-copy"><strong>{t('shell.workspace')}</strong><span>{apiLive ? t('shell.connected') : t('shell.waiting')}</span></div><ChevronDown size={14} /></div>
        <nav className="nav-area">
          {navGroups.map((group) => <div className="nav-group" key={group.labelKey}><div className="nav-label">{t(group.labelKey)}</div>{group.items.map(({ id, icon: NavIcon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => selectPage(id)} aria-label={t(`nav.${id}`)}><NavIcon size={16} /><span>{t(`nav.${id}`)}</span>{id === 'servers' && servers && servers.length > 0 && <span className="nav-count">{servers.length}</span>}</button>)}</div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-link"><CircleHelp size={15} /><span>{t('shell.help')}</span><ExternalLink size={12} /></div>
          <div className="user-card"><div className="avatar">{(authUser?.display_name ?? '—').slice(0, 2).toUpperCase()}</div><div className="user-copy"><strong>{authUser?.display_name ?? t('shell.unknownUser')}</strong><span>{authUser?.email ?? t('shell.unknownIdentity')}</span></div><MoreHorizontal size={16} /></div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-leading"><IconButton label={t('shell.openNav')} onClick={() => setSidebarOpen(true)}><Menu size={18} /></IconButton><div className="breadcrumbs"><span>{t('shell.console')}</span><span>/</span><strong>{meta.title}</strong></div></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('shell.search')} /><span className="shortcut"><Command size={11} /> K</span></label>
            <div className="theme-menu"><IconButton label={t('theme.label', { label: themeLabel })}><Sun size={16} /><ChevronDown size={11} /></IconButton><select aria-label={t('theme.select')} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="dark">{t('theme.dark')}</option><option value="light">{t('theme.light')}</option><option value="system">{t('theme.system')}</option></select></div>
            <div className="theme-menu language-menu"><IconButton label={t('language.label')}><Globe2 size={16} /><ChevronDown size={11} /></IconButton><select aria-label={t('language.select')} value={language} onChange={(e) => changeLanguage(e.target.value as Language)}><option value="zh-CN">{t('language.zh')}</option><option value="en">{t('language.en')}</option></select></div>
            <IconButton label={t('shell.auditEvents')} onClick={() => selectPage('audit')}><Activity size={16} /></IconButton>
            <div className="top-avatar" aria-label={authUser?.display_name ?? authUser?.email ?? t('shell.currentUser')}>{userInitials}</div>
          </div>
        </header>
        <div className="page-scroll">
          <div className="page-content">
            <div className="page-header"><div><div className="eyebrow"><span className="live-pulse" />{apiLive ? t('shell.live') : t('shell.waitingData')}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="header-actions">{page === 'overview' && <button className="button secondary" onClick={() => void refreshData()} disabled={dataLoading}><RefreshCw size={15} />{t('shell.refresh')}</button>}{page === 'servers' && <button className="button primary" onClick={() => setModal('server')}><Plus size={16} />{t('shell.bindServer')}</button>}{page === 'domains' && <button className="button primary" onClick={() => setModal('domain')}><Plus size={16} />{t('shell.assignDomain')}</button>}{page === 'plugins' && <button className="button primary" onClick={() => setModal('plugin')}><Plus size={16} />{t('shell.loadPlugin')}</button>}</div></div>
            {dataError && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('shell.loadFailed')}</strong><span>{translateError(dataError ?? '')}</span></div><button onClick={() => void refreshData()}>{t('shell.retry')} <RefreshCw size={14} /></button></div>}
            {page === 'overview' && <Overview overview={overview} usage={usage} localUsage={localUsage} settings={platformSettings} audits={audits ?? []} accessLogs={accessLogs} accessLogsLoading={accessLogsLoading} accessLogsError={accessLogsError} servers={servers ?? []} range={range} setRange={setRange} onNavigate={selectPage} />}
            {page === 'servers' && <Servers servers={servers ?? []} loading={dataLoading} onRefresh={() => void refreshData()} onBind={() => setModal('server')} onDetail={(id) => void openDetail('server', id)} />}
            {page === 'plugins' && <Plugins plugins={filteredPlugins} loading={dataLoading} onAction={() => void syncManifests()} onLoad={() => setModal('plugin')} onDetail={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} />}
            {page === 'domains' && <Domains domains={domains ?? []} loading={dataLoading} onAction={showToast} onRefresh={() => void refreshData()} onAssign={() => setModal('domain')} />}
            {page === 'usage' && <Usage settings={platformSettings} usage={usage} localUsage={localUsage} loading={usageLoading} error={usageError} onNavigate={selectPage} />}
            {page === 'logs' && <AccessLogs logs={accessLogs ?? []} loading={accessLogsLoading} error={accessLogsError} onExport={exportAccessLogs} />}
            {page === 'audit' && <Audit audits={audits ?? []} loading={auditLoading} error={auditError} onExport={exportAudit} />}
            {page === 'settings' && <SettingsPage settings={platformSettings} apiLive={apiLive} onSettingsChange={setPlatformSettings} cloudflareSettings={cloudflareSettings} onCloudflareChange={setCloudflareSettings} smtpSettings={smtpSettings} onSmtpChange={setSmtpSettings} oauthSettings={oauthSettings} onOauthChange={setOauthSettings} invites={invites} onInvitesChange={setInvites} onAction={showToast} />}
          </div>
        </div>
      </main>
      {modal && <Modal type={modal} plugins={plugins ?? []} onClose={() => setModal(null)} onConfirm={(input) => confirmModal(modal, input)} />}
      {detail && <DetailModal detail={detail} data={detailData} loading={detailLoading} error={detailError} healthLoading={healthPluginId === detail.id} actionLoading={pluginActionLoading?.id === detail.id ? pluginActionLoading.action : null} onClose={() => setDetail(null)} onOpenPlugin={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} onAction={(plugin, action) => void runPluginAction(plugin, action)} />}
      {toast && <div className="toast"><div className="toast-icon"><Check size={14} /></div>{toast}</div>}
    </div>
  )
}

function Overview({ overview, usage, localUsage, settings, audits, accessLogs, accessLogsLoading, accessLogsError, servers, range, setRange, onNavigate }: { overview: ApiOverview | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; settings: PlatformSettings | null; audits: ApiAudit[]; accessLogs: ApiAccessLog[] | null; accessLogsLoading: boolean; accessLogsError: string | null; servers: ApiServer[]; range: '24h' | '7d' | '30d'; setRange: (value: '24h' | '7d' | '30d') => void; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const onlineServers = overview ? String(overview.onlineServers) : '—'
  const enabledPlugins = overview ? String(overview.enabledPlugins) : '—'
  const domains = overview ? String(overview.domains) : '—'
  const activeConnections = localUsage ? formatNumber(localUsage.activeConnections) : '—'
  const requestCount = localUsage ? formatNumber(localUsage.requestCount) : '—'
  const requestLimit = settings ? formatNumber(settings.quotas.requests) : notRead
  const r2Value = localUsage ? formatBytes(localUsage.r2Bytes) ?? notRead : '—'
  const r2Limit = settings ? formatBytes(settings.quotas.r2Bytes) ?? notRead : notRead
  const d1Queries = usage?.d1 ? usage.d1.readQueries + usage.d1.writeQueries : null
  const kvOperations = usage?.kv ? usage.kv.read + usage.kv.write + usage.kv.delete + usage.kv.list : null
  const durableObjectRequests = usage?.durableObjects?.requests ?? null
  const d1Limit = settings ? formatNumber(settings.quotas.d1Queries) : notRead
  const kvLimit = settings ? formatNumber(settings.quotas.kvOperations) : notRead
  const durableObjectLimit = settings ? formatNumber(settings.quotas.durableObjectRequests) : notRead
  const requestPercent = usagePercent(localUsage?.requestCount, settings?.quotas.requests)
  const r2Percent = usagePercent(localUsage?.r2Bytes, settings?.quotas.r2Bytes)
  const d1Percent = usagePercent(d1Queries, settings?.quotas.d1Queries)
  const kvPercent = usagePercent(kvOperations, settings?.quotas.kvOperations)
  const durableObjectPercent = usagePercent(durableObjectRequests, settings?.quotas.durableObjectRequests)
  const apiNote = overview ? t('overview.note.fromApi') : t('common.noData')
  const localNote = localUsage ? t('overview.note.localCount') : t('overview.note.noLocalCount')
  const recentErrors = (accessLogs ?? []).filter((log) => log.status >= 500).slice(0, 3)
  const connectionIssues = servers.filter((server) => server.status !== 'online').slice(0, 3)
  return <>
    <div className="notice-bar"><div className="notice-icon"><ShieldCheck size={16} /></div><div><strong>{overview ? t('overview.noticeConnected') : t('overview.noticeWaiting')}</strong><span>{overview ? t('overview.noticeConnectedBody') : t('overview.noticeWaitingBody')}</span></div><StatusBadge tone={settings ? settings.maintenance ? 'warning' : 'success' : 'neutral'}>{settings ? settings.maintenance ? t('overview.maintenance.on') : t('overview.maintenance.off') : t('overview.maintenance.unknown')}</StatusBadge><button onClick={() => onNavigate('settings')}>{t('overview.configure')} <ArrowUpRight size={14} /></button></div>
    <section className="metric-grid">
      <Metric label={t('overview.metric.onlineServers')} value={onlineServers} suffix="" note={apiNote} icon={Server} tone="green" onClick={() => onNavigate('servers')} />
      <Metric label={t('overview.metric.enabledPlugins')} value={enabledPlugins} suffix="" note={apiNote} icon={Box} tone="blue" onClick={() => onNavigate('plugins')} />
      <Metric label={t('overview.metric.domains')} value={domains} suffix="" note={apiNote} icon={Globe2} tone="purple" onClick={() => onNavigate('domains')} />
      <Metric label={t('overview.metric.connections')} value={activeConnections} suffix="" note={localNote} icon={Zap} tone="amber" onClick={() => onNavigate('usage')} />
    </section>
    <section className="content-grid two-thirds">
      <div className="panel chart-panel"><div className="panel-header"><div><h2>{t('overview.trend.title')}</h2><p>{t('overview.trend.subtitle')}</p></div><div className="segmented">{(['24h', '7d', '30d'] as const).map((item) => <button className={range === item ? 'selected' : ''} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div><RequestTrend range={range} snapshots={localUsage?.snapshots ?? []} /></div>
      <div className="panel"><div className="panel-header"><div><h2>{t('overview.resources.title')}</h2><p>{t('overview.resources.subtitle')}</p></div><IconButton label={t('overview.resources.detail')} onClick={() => onNavigate('usage')}><ArrowUpRight size={15} /></IconButton></div><div className="resource-list"><Resource label={t('overview.resources.requests')} value={requestCount} limit={requestLimit} percent={requestPercent} icon={Cloud} /><Resource label={t('overview.resources.r2')} value={r2Value} limit={r2Limit} percent={r2Percent} icon={HardDrive} /><Resource label={t('overview.resources.d1')} value={d1Queries === null ? '—' : formatNumber(d1Queries)} limit={d1Limit} percent={d1Percent} icon={Database} /><Resource label={t('overview.resources.kv')} value={kvOperations === null ? '—' : formatNumber(kvOperations)} limit={kvLimit} percent={kvPercent} icon={HardDrive} /><Resource label={t('overview.resources.durableObjects')} value={durableObjectRequests === null ? '—' : formatNumber(durableObjectRequests)} limit={durableObjectLimit} percent={durableObjectPercent} icon={Activity} /></div><div className="resource-sources"><span>{usage?.updatedAt ? t('overview.resources.officialUpdated', { time: formatDateTime(usage.updatedAt) }) : t('overview.resources.officialMissing')}</span><span>{localUsage?.updatedAt ? t('overview.resources.localUpdated', { time: formatDateTime(localUsage.updatedAt) }) : t('overview.resources.localMissing')}</span></div><button className="text-link" onClick={() => onNavigate('usage')}>{t('overview.resources.allQuotas')} <ArrowUpRight size={14} /></button></div>
    </section>
    <section className="content-grid two-thirds bottom-grid"><div className="panel"><div className="panel-header"><div><h2>{t('overview.activity.title')}</h2><p>{t('overview.activity.subtitle')}</p></div><button className="text-link" onClick={() => onNavigate('audit')}>{t('overview.activity.viewAll')} <ArrowUpRight size={14} /></button></div>{audits.length > 0 ? <div className="activity-list">{audits.slice(0, 3).map((item) => <div className="activity-item" key={item.id}><div className="activity-mark success"><Check size={13} /></div><div className="activity-copy"><strong>{auditActionLabel(item.action)}</strong><span>{auditDetail(item)}</span></div><time>{formatDateTime(item.created_at)}</time></div>)}</div> : <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>{t('overview.activity.emptyTitle')}</h3><p>{t('overview.activity.emptyBody')}</p></div>}</div><div className="panel quick-panel"><div className="panel-header"><div><h2>{t('overview.quick.title')}</h2><p>{t('overview.quick.subtitle')}</p></div></div><QuickStep number="01" title={t('overview.quick.bindTitle')} detail={t('overview.quick.bindDetail')} onClick={() => onNavigate('servers')} /><QuickStep number="02" title={t('overview.quick.loadTitle')} detail={t('overview.quick.loadDetail')} onClick={() => onNavigate('plugins')} /><QuickStep number="03" title={t('overview.quick.domainTitle')} detail={t('overview.quick.domainDetail')} onClick={() => onNavigate('domains')} /></div></section>
    <section className="panel bottom-grid"><div className="panel-header"><div><h2>{t('overview.errors.title')}</h2><p>{t('overview.errors.subtitle')}</p></div><button className="text-link" onClick={() => onNavigate('logs')}>{t('overview.errors.viewAll')} <ArrowUpRight size={14} /></button></div>{connectionIssues.length > 0 || (!accessLogsError && !accessLogsLoading && recentErrors.length > 0) ? <div className="activity-list">{connectionIssues.map((server) => <div className="activity-item" key={server.id}><div className="activity-mark danger"><Server size={13} /></div><div className="activity-copy"><strong>{server.name}</strong><span>{server.last_seen_at ? t('servers.lastSeen', { time: formatDateTime(server.last_seen_at) }) : t('servers.neverConnected')}</span></div><StatusBadge tone="danger">{t(`status.${server.status}`, { defaultValue: server.status })}</StatusBadge></div>)}{recentErrors.map((log) => <div className="activity-item" key={log.id}><div className="activity-mark danger"><AlertCircle size={13} /></div><div className="activity-copy"><strong>{log.hostname}{log.path}</strong><span>{log.method} · {log.error ?? t('overview.errors.unknownError')}</span></div><StatusBadge tone="danger">{log.status}</StatusBadge><time>{formatDateTime(log.created_at)}</time></div>)}</div> : accessLogsError ? <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('overview.errors.loadFailed')}</strong><span>{translateError(accessLogsError)}</span></div></div> : accessLogsLoading ? <div className="empty-panel"><div className="empty-illustration"><RefreshCw size={20} /></div><h3>{t('overview.errors.loadingTitle')}</h3><p>{t('overview.errors.loadingBody')}</p></div> : <div className="empty-panel"><div className="empty-illustration"><ShieldCheck size={20} /></div><h3>{t('overview.errors.emptyTitle')}</h3><p>{t('overview.errors.emptyBody')}</p></div>}</section>
  </>
}

function Metric({ label, value, suffix, note, icon: Icon, tone, onClick }: { label: string; value: string; suffix: string; note: string; icon: typeof Server; tone: string; onClick: () => void }) { return <button className="metric-card" onClick={onClick}><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div className="metric-label">{label}<ArrowUpRight size={13} /></div><div className="metric-number">{value}<small>{suffix}</small></div><div className="metric-note"><span className="status-dot green" />{note}</div></button> }

function RequestTrend({ range, snapshots }: { range: '24h' | '7d' | '30d'; snapshots: UsageSnapshot[] }) {
  const { t } = useTranslation()
  const sampled = sampleUsageSnapshots(snapshots)
  if (sampled.length === 0) return <div className="empty-chart chart-empty-state"><Activity size={20} /><strong>{t('overview.trend.emptyTitle')}</strong><span>{t('overview.trend.emptyBody')}</span></div>
  const maximum = Math.max(...sampled.map((snapshot) => snapshot.request_count), 1)
  const first = sampled[0]
  const last = sampled[sampled.length - 1]
  return <div className="empty-chart" role="img" aria-label={t('overview.trend.aria', { range })}><div className="chart-grid-lines"><span /><span /><span /><span /></div><div className="chart-bars">{sampled.map((snapshot) => <div className="bar-wrap" key={snapshot.captured_at}><div className="chart-bar accent" style={{ height: `${Math.max(6, snapshot.request_count / maximum * 100)}%` }} title={t('overview.trend.tooltip', { time: formatTrendTime(snapshot.captured_at), count: formatNumber(snapshot.request_count) })} /></div>)}</div><div className="chart-axis"><span>{formatTrendTime(first.captured_at)}</span><span>{formatTrendTime(last.captured_at)}</span></div><div className="chart-footnote"><span><span className="legend-dot" />{t('overview.trend.series')}</span><span>{t('overview.trend.summary', { range, count: formatNumber(last.request_count) })}</span></div></div>
}

function sampleUsageSnapshots(snapshots: UsageSnapshot[], limit = 24): UsageSnapshot[] {
  if (snapshots.length <= limit) return snapshots
  const bucketSize = Math.ceil(snapshots.length / limit)
  return Array.from({ length: Math.ceil(snapshots.length / bucketSize) }, (_, index) => snapshots[Math.min((index + 1) * bucketSize - 1, snapshots.length - 1)])
}

function formatTrendTime(value: string): string {
  return new Date(value).toLocaleString(currentLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Resource({ label, value, limit, percent, icon: Icon }: { label: string; value: string; limit: string; percent: number; icon: typeof Cloud }) {
  const { t } = useTranslation()
  return <div className="resource"><div className="resource-top"><div className="resource-label"><Icon size={15} />{label}</div><strong>{value}</strong></div><div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div><div className="resource-bottom"><span>{t('common.currentUsage')}</span><span>{limit}</span></div></div>
}

function usagePercent(current: number | null | undefined, limit: number | null | undefined): number {
  if (current == null || limit == null || !Number.isFinite(current) || !Number.isFinite(limit) || current < 0 || limit <= 0) return 0
  return Math.min(100, (current / limit) * 100)
}

function QuickStep({ number, title, detail, done, onClick }: { number: string; title: string; detail: string; done?: boolean; onClick: () => void }) { return <button className="quick-step" onClick={onClick}><span className={`step-number ${done ? 'done' : ''}`}>{done ? <Check size={13} /> : number}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></button> }

function capabilityLabel(plugin: ApiPlugin): string {
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

function auditActionLabel(action: string): string {
  return i18n.t(`auditActions.${action}`, { defaultValue: action })
}

function auditDetail(item: ApiAudit): string {
  try {
    const details = JSON.parse(item.detail_json) as Record<string, unknown>
    const values = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== '')
    return values.length > 0 ? values.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ') : '—'
  } catch {
    return item.detail_json || '—'
  }
}

function Servers({ servers, loading, onRefresh, onBind, onDetail }: { servers: ApiServer[]; loading: boolean; onRefresh: () => void; onBind: () => void; onDetail: (id: string) => void }) {
  const { t } = useTranslation()
  return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>{t('servers.title')}</h2><p>{t('servers.subtitle')}</p></div><button className="button secondary small" onClick={onRefresh} disabled={loading}><RefreshCw size={14} />{t('servers.refresh')}</button></div>{servers.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Server size={22} /></div><h3>{t('servers.emptyTitle')}</h3><p>{t('servers.emptyBody')}</p></div> : <div className="server-list">{servers.map((server) => <div className="server-row" key={server.id}><div className="server-symbol"><Server size={18} /></div><div className="server-main"><strong>{server.name}</strong><span>{server.id} · {t('common.protocolVersion')}</span></div><StatusBadge tone={server.status === 'online' ? 'success' : server.status === 'revoked' ? 'danger' : 'warning'}>{t(`status.${server.status}`, { defaultValue: server.status })}</StatusBadge><div className="server-meta"><span>{server.last_seen_at ? t('servers.lastSeen', { time: formatDateTime(server.last_seen_at) }) : t('servers.neverConnected')}</span><button className="row-action" onClick={() => onDetail(server.id)} aria-label={t('servers.view', { name: server.name })} title={t('servers.viewTitle')}><MoreHorizontal size={17} /></button></div></div>)}</div>}</div><div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>{t('servers.bindTitle')}</h3><p>{t('servers.bindBody')}</p><button className="button primary" onClick={onBind}><Plus size={15} />{t('servers.bind')}</button></div></div>
}

function Plugins({ plugins, loading, onAction, onLoad, onDetail, onHealth }: { plugins: ApiPlugin[]; loading: boolean; onAction: (message: string) => void; onLoad: () => void; onDetail: (id: string) => void; onHealth: (plugin: ApiPlugin) => void }) {
  const { t } = useTranslation()
  const enabled = plugins.filter((plugin) => plugin.state === 'enabled').length
  return <div className="stack"><div className="filter-row"><div className="filter-summary"><span className="filter-dot" />{t('plugins.enabled', { count: enabled })} <span className="divider" />{t('plugins.discovered', { count: plugins.length })}</div><button className="button secondary small" onClick={() => onAction(loading ? t('plugins.reading') : t('plugins.syncHint'))} disabled={loading}><RefreshCw size={14} />{t('plugins.sync')}</button></div>{plugins.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Code2 size={22} /></div><h3>{t('plugins.emptyTitle')}</h3><p>{t('plugins.emptyBody')}</p><button className="button primary" onClick={onLoad}><Plus size={15} />{t('plugins.load')}</button></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>{t('plugins.columnPlugin')}</th><th>{t('plugins.columnServer')}</th><th>{t('plugins.columnState')}</th><th>{t('plugins.columnCapability')}</th><th>{t('plugins.columnDomain')}</th><th /></tr></thead><tbody>{plugins.map((plugin) => <tr key={plugin.id}><td><div className="cell-title"><div className="table-icon"><Code2 size={15} /></div><div><strong>{plugin.name}</strong><small>{plugin.plugin_id} · v{plugin.version}</small></div></div></td><td>{plugin.server_name}</td><td><StatusBadge tone={plugin.state === 'enabled' ? 'success' : plugin.state === 'failed' ? 'danger' : 'neutral'}>{t(`status.${plugin.state}`, { defaultValue: plugin.state })}</StatusBadge></td><td><span className="capability">{capabilityLabel(plugin)}</span></td><td>{plugin.domain_hostname ? <a href={`https://${plugin.domain_hostname}`} target="_blank" rel="noreferrer">{plugin.domain_hostname}</a> : <span className="muted">{t('common.notAssigned')}</span>}</td><td className="row-actions"><>{plugin.state === 'enabled' && <button className="row-action" onClick={() => onHealth(plugin)} aria-label={t('plugins.health', { name: plugin.name })} title={t('plugins.healthTitle')}><Activity size={16} /></button>}<button className="row-action" onClick={() => onDetail(plugin.id)} aria-label={t('plugins.view', { name: plugin.name })} title={t('plugins.viewTitle')}><MoreHorizontal size={17} /></button></></td></tr>)}</tbody></table></div><div className="table-footer"><span>{t('plugins.footer', { count: plugins.length })}</span><button className="text-link" onClick={onLoad}>{t('plugins.load')} <Plus size={14} /> </button></div></div>}</div>
}

function Domains({ domains, loading, onAction, onRefresh, onAssign }: { domains: ApiDomain[]; loading: boolean; onAction: (message: string) => void; onRefresh: () => void; onAssign: () => void }) {
  const { t } = useTranslation()
  const copyDomain = async (hostname: string) => {
    if (!navigator.clipboard) {
      onAction(t('domains.clipboardUnsupported'))
      return
    }
    try {
      await navigator.clipboard.writeText(hostname)
      onAction(t('domains.copied'))
    } catch {
      onAction(t('domains.copyFailed'))
    }
  }
  return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>{t('domains.title')}</h2><p>{t('domains.subtitle')}</p></div><button className="button secondary small" onClick={onRefresh} disabled={loading}><RefreshCw size={14} />{t('servers.refresh')}</button></div>{domains.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>{t('domains.emptyTitle')}</h3><p>{t('domains.emptyBody')}</p></div> : <div className="domain-list">{domains.map((domain) => <div className="domain-row" key={domain.id}><div className="domain-icon"><Globe2 size={17} /></div><div className="domain-main"><strong>{domain.hostname}</strong><span>{domain.plugin_name} · {domain.plugin_instance_id}</span></div><StatusBadge tone={domain.status === 'online' ? 'success' : 'warning'}>{t(`status.${domain.status}`, { defaultValue: domain.status })}</StatusBadge><span className="domain-latency">{domain.status === 'online' ? t('domains.available') : t('domains.waiting')}</span><button className="row-action" onClick={() => void copyDomain(domain.hostname)} aria-label={t('domains.copy', { hostname: domain.hostname })} title={t('domains.copy', { hostname: domain.hostname })}><Copy size={16} /></button></div>)}</div>}</div><div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>{t('domains.assignTitle')}</h3><p>{t('domains.assignBody')}</p><button className="button primary" onClick={onAssign}><Plus size={15} />{t('domains.assign')}</button></div></div>
}

function Usage({ settings, usage, localUsage, loading, error, onNavigate }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; loading: boolean; error: string | null; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  const notRead = t('common.notRead')
  const period = usage?.period
  const requests = usage?.requests
  const d1 = usage?.d1
  const kv = usage?.kv
  const durableObjects = usage?.durableObjects
  const quotas = settings?.quotas
  const hasLocalUsage = localUsage !== null
  const requestValue = typeof requests === 'number' ? formatNumber(requests) : '—'
  const localRequestValue = hasLocalUsage ? formatNumber(localUsage.requestCount) : '—'
  const requestLimit = quotas ? formatNumber(quotas.requests) : notRead
  const connectionLimit = quotas ? formatNumber(quotas.activeConnections) : notRead
  const r2Limit = quotas ? formatBytes(quotas.r2Bytes) ?? notRead : notRead
  const d1Limit = quotas ? formatNumber(quotas.d1Queries) : notRead
  const kvLimit = quotas ? formatNumber(quotas.kvOperations) : notRead
  const durableObjectLimit = quotas ? formatNumber(quotas.durableObjectRequests) : notRead
  const connected = usage?.configured === true && typeof requests === 'number'
  const d1Queries = d1 ? d1.readQueries + d1.writeQueries : null
  const kvOperations = kv ? kv.read + kv.write + kv.delete + kv.list : null
  const workerPercent = usagePercent(connected && typeof requests === 'number' ? requests : null, quotas?.requests)
  const localRequestPercent = usagePercent(localUsage?.requestCount, quotas?.requests)
  const r2Percent = usagePercent(localUsage?.r2Bytes, quotas?.r2Bytes)
  const connectionPercent = usagePercent(localUsage?.activeConnections, quotas?.activeConnections)
  const d1Percent = usagePercent(d1Queries, quotas?.d1Queries)
  const kvPercent = usagePercent(kvOperations, quotas?.kvOperations)
  const durableObjectPercent = usagePercent(durableObjects?.requests, quotas?.durableObjectRequests)
  const usageUpdatedAt = usage?.updatedAt
  const localUpdatedAt = localUsage?.updatedAt
  const requestWindowStartedAt = localUsage?.requestWindowStartedAt

  return <div className="stack">
    {error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('usage.loadFailed')}</strong><span>{translateError(error)}</span></div><button onClick={() => onNavigate('settings')}>{t('usage.checkConfig')} <ArrowUpRight size={14} /></button></div>}
    {!error && <div className="notice-bar compact"><div className="notice-icon"><Cloud size={16} /></div><div><strong>{loading ? t('usage.loadingOfficial') : connected ? t('usage.connected') : t('usage.notConnected')}</strong><span>{connected && period ? t('usage.period', { start: formatDateTime(period.start), end: formatDateTime(period.end) }) : t('usage.periodHint')}</span></div><button onClick={() => onNavigate('settings')}>{t('usage.configure')} <ArrowUpRight size={14} /></button></div>}
    <div className="usage-grid">
      <ResourceCard title={t('usage.card.workerRequests')} current={requestValue} limit={requestLimit} unit={connected ? t('usage.card.officialPeriod') : ''} percent={workerPercent} icon={Cloud} />
      <ResourceCard title={t('usage.card.platformRequests')} current={localRequestValue} limit={requestLimit} unit={hasLocalUsage ? t('usage.card.window24h') : t('usage.card.notConnected')} percent={localRequestPercent} icon={Activity} />
      <ResourceCard title={t('usage.card.r2')} current={hasLocalUsage ? formatBytes(localUsage.r2Bytes) ?? '—' : '—'} limit={r2Limit} unit={hasLocalUsage ? t('usage.card.objects', { count: localUsage.r2Objects }) : quotas ? t('usage.card.platformQuota') : ''} percent={r2Percent} icon={HardDrive} />
      <ResourceCard title={t('usage.card.connections')} current={hasLocalUsage ? formatNumber(localUsage.activeConnections) : '—'} limit={connectionLimit} unit={hasLocalUsage ? t('usage.card.connectionsUnit') : t('usage.card.notConnected')} percent={connectionPercent} icon={Activity} />
      <ResourceCard title={t('usage.card.d1')} current={d1Queries === null ? '—' : formatNumber(d1Queries)} limit={d1Limit} unit={d1 ? t('usage.card.rowsRead', { count: formatNumber(d1.rowsRead) }) : ''} percent={d1Percent} icon={Database} />
      <ResourceCard title={t('usage.card.kv')} current={kvOperations === null ? '—' : formatNumber(kvOperations)} limit={kvLimit} unit={kv ? t('usage.card.kvReads', { count: formatNumber(kv.read) }) : ''} percent={kvPercent} icon={HardDrive} />
      <ResourceCard title={t('usage.card.durableObjects')} current={durableObjects ? formatNumber(durableObjects.requests) : '—'} limit={durableObjectLimit} unit={durableObjects ? t('usage.card.storage', { size: formatBytes(durableObjects.storedBytes) ?? '—' }) : ''} percent={durableObjectPercent} icon={Activity} />
    </div>
    <div className="panel"><div className="panel-header"><div><h2>{t('usage.sourcesTitle')}</h2><p>{t('usage.sourcesSubtitle')}</p></div></div><div className="source-row"><span className="source-name"><span className={`source-dot ${connected ? 'green' : 'pending'}`} />Cloudflare Analytics API</span><span className="muted">{connected ? `${usage?.cached ? t('usage.cached') : t('usage.latest')} · ${usageUpdatedAt ? formatDateTime(usageUpdatedAt) : t('usage.unknownTime')}` : t('usage.notConfigured')}</span><button className="text-link" onClick={() => onNavigate('settings')}>{t('usage.configureSource')} <ArrowUpRight size={14} /></button></div><div className="source-row"><span className="source-name"><span className={`source-dot ${hasLocalUsage ? 'green' : 'pending'}`} />{t('overview.note.localCount')}</span><span className="muted">{localUpdatedAt ? t('usage.updatedAt', { time: formatDateTime(localUpdatedAt) }) : t('usage.card.notConnected')}</span><span className="muted">{requestWindowStartedAt ? t('usage.windowStartedAt', { time: formatDateTime(requestWindowStartedAt) }) : t('usage.noData')}</span></div></div>
    <div className="panel breakdown-panel"><div className="panel-header"><div><h2>{t('usage.breakdown.title')}</h2><p>{t('usage.breakdown.subtitle')}</p></div></div><div className="breakdown-grid"><BreakdownColumn title={t('usage.breakdown.users')} rows={localUsage?.breakdown.users ?? []} /><BreakdownColumn title={t('usage.breakdown.plugins')} rows={localUsage?.breakdown.plugins ?? []} /><BreakdownColumn title={t('usage.breakdown.domains')} rows={localUsage?.breakdown.domains ?? []} /></div></div>
  </div>
}

function BreakdownColumn({ title, rows }: { title: string; rows: UsageBreakdownEntry[] }) {
  const { t } = useTranslation()
  return <div className="breakdown-column"><h3>{title}</h3>{rows.length === 0 ? <p className="breakdown-empty">{t('usage.breakdown.empty')}</p> : rows.map((row) => <div className="breakdown-row" key={row.id}><span title={row.label}>{row.label}</span><strong>{formatNumber(row.requests)}</strong></div>)}</div>
}

function formatBytes(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(value / 1024)} KB`
}

function ResourceCard({ title, current, limit, unit, percent = 0, icon: Icon }: { title: string; current: string; limit: string; unit: string; percent?: number; icon: typeof Cloud }) {
  const { t } = useTranslation()
  return <div className="resource-card"><div className="resource-card-head"><div className="resource-card-icon"><Icon size={17} /></div><span>{title}</span></div><strong>{current}</strong><div className="resource-card-limit">{t('common.upperLimit', { limit })} <span>{unit}</span></div><div className="progress"><span style={{ width: `${percent}%` }} /></div></div>
}

function AccessLogs({ logs, loading, error, onExport }: { logs: ApiAccessLog[]; loading: boolean; error: string | null; onExport: () => void }) {
  const { t } = useTranslation()
  const errors = logs.filter((log) => log.status >= 500).length
  return <div className="stack">{error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('logs.loadFailed')}</strong><span>{translateError(error)}</span></div></div>}<div className="filter-row"><div className="filter-summary"><Activity size={15} />{t('logs.last30Days')} <span className="divider" />{t('logs.errors', { count: errors })}</div><button className="button secondary small" onClick={onExport} disabled={loading || logs.length === 0}><Download size={14} />{t('logs.export')}</button></div>{loading ? <div className="empty-panel"><div className="empty-illustration"><RefreshCw size={20} /></div><h3>{t('logs.loadingTitle')}</h3><p>{t('logs.loadingBody')}</p></div> : logs.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>{t('logs.emptyTitle')}</h3><p>{t('logs.emptyBody')}</p></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>{t('logs.columnHost')}</th><th>{t('logs.columnRequest')}</th><th>{t('logs.columnStatus')}</th><th>{t('logs.columnDuration')}</th><th>{t('logs.columnTime')}</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td><div className="cell-title"><div className="table-icon"><Globe2 size={15} /></div><div><strong>{log.hostname}</strong><small>{log.path}</small></div></div></td><td>{log.method}</td><td><StatusBadge tone={log.status >= 500 ? 'danger' : log.status >= 400 ? 'warning' : 'success'}>{log.status}{log.error ? ` · ${log.error}` : ''}</StatusBadge></td><td>{log.duration_ms} ms</td><td className="muted">{formatDateTime(log.created_at)}</td></tr>)}</tbody></table></div></div>}</div>
}

function Audit({ audits, loading, error, onExport }: { audits: ApiAudit[]; loading: boolean; error: string | null; onExport: () => void }) {
  const { t } = useTranslation()
  return <div className="stack">{error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('audit.loadFailed')}</strong><span>{translateError(error)}</span></div></div>}<div className="filter-row"><div className="filter-summary"><ListFilter size={15} />{t('audit.allEvents')} <span className="divider" />{t('audit.last180Days')}</div><button className="button secondary small" onClick={onExport} disabled={loading || audits.length === 0}><Download size={14} />{t('audit.export')}</button></div>{loading ? <div className="empty-panel"><div className="empty-illustration"><RefreshCw size={20} /></div><h3>{t('audit.loadingTitle')}</h3><p>{t('audit.loadingBody')}</p></div> : audits.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>{t('audit.emptyTitle')}</h3><p>{t('audit.emptyBody')}</p></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>{t('audit.columnEvent')}</th><th>{t('audit.columnDetail')}</th><th>{t('audit.columnActor')}</th><th>{t('audit.columnTime')}</th></tr></thead><tbody>{audits.map((item) => <tr key={item.id}><td><div className="cell-title"><div className="audit-icon"><Activity size={14} /></div><strong>{auditActionLabel(item.action)}</strong></div></td><td>{auditDetail(item)}</td><td><span className="operator"><div className="mini-avatar">{(item.actor_name ?? t('common.system')).slice(0, 1)}</div><span>{item.actor_name ?? t('audit.systemEvent')}<small>{item.actor_email ?? t('audit.noIdentity')}</small></span></span></td><td className="muted">{formatDateTime(item.created_at)}</td></tr>)}</tbody></table></div></div>}</div>
}

function SettingsPage({ settings, onSettingsChange, apiLive, cloudflareSettings, onCloudflareChange, smtpSettings, onSmtpChange, oauthSettings, onOauthChange, invites, onInvitesChange, onAction }: { settings: PlatformSettings | null; onSettingsChange: (settings: PlatformSettings) => void; cloudflareSettings: CloudflareSettings | null; onCloudflareChange: (settings: CloudflareSettings) => void; smtpSettings: SmtpSettings | null; onSmtpChange: (settings: SmtpSettings) => void; oauthSettings: OauthSettings | null; onOauthChange: (settings: OauthSettings) => void; invites: ApiInvite[] | null; onInvitesChange: (invites: ApiInvite[]) => void; onAction: (message: string) => void; apiLive: boolean }) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [suffixSaving, setSuffixSaving] = useState(false)
  const [quotaForm, setQuotaForm] = useState({ requests: '', activeConnections: '', r2Bytes: '', r2Objects: '', d1Queries: '', kvOperations: '', durableObjectRequests: '' })
  const [domainSuffix, setDomainSuffix] = useState('')
  const [activeSection, setActiveSection] = useState('cloudflare')
  const maintenance = settings?.maintenance ?? false
  useEffect(() => {
    if (!settings) return
    setQuotaForm({ requests: String(settings.quotas.requests), activeConnections: String(settings.quotas.activeConnections), r2Bytes: String(settings.quotas.r2Bytes), r2Objects: String(settings.quotas.r2Objects), d1Queries: String(settings.quotas.d1Queries), kvOperations: String(settings.quotas.kvOperations), durableObjectRequests: String(settings.quotas.durableObjectRequests) })
    setDomainSuffix(settings.pluginDomainSuffix)
  }, [settings])
  const toggleMaintenance = async () => {
    if (!settings) {
      onAction(t('settings.maintenance.notConnected'))
      return
    }
    setSaving(true)
    try {
      onSettingsChange(await updatePlatformSettings({ ...settings, maintenance: !maintenance }))
      onAction(!maintenance ? t('settings.maintenance.enter') : t('settings.maintenance.resume'))
    } catch {
      onAction(t('settings.maintenance.updateFailed'))
    } finally {
      setSaving(false)
    }
  }
  const startCloudflareAuth = () => { window.location.assign(`${import.meta.env.VITE_API_BASE ?? ''}/auth/cloudflare/start`) }
  const revokeCloudflare = async () => {
    if (!cloudflareSettings?.configured || !window.confirm(t('settings.cloudflare.revokeConfirm'))) return
    try {
      onCloudflareChange(await revokeCloudflareSettings())
      onAction(t('settings.cloudflare.revoked'))
    } catch {
      onAction(t('settings.cloudflare.revokeFailed'))
    }
  }
  const saveDomainSuffix = async () => {
    if (!settings) return onAction(t('settings.domainSuffix.notConnected'))
    if (!domainSuffix.trim()) return onAction(t('settings.domainSuffix.invalid'))
    setSuffixSaving(true)
    try {
      const next = await updatePlatformSettings({ ...settings, pluginDomainSuffix: domainSuffix.trim() })
      onSettingsChange(next)
      setDomainSuffix(next.pluginDomainSuffix)
      onAction(t('settings.domainSuffix.saved'))
    } catch (error) {
      onAction(error instanceof ApiError && error.status === 400 ? t('settings.domainSuffix.invalid') : t('settings.domainSuffix.saveFailed'))
    } finally {
      setSuffixSaving(false)
    }
  }
  const saveQuotas = async () => {
    if (!settings) return onAction(t('settings.quotas.notConnected'))
    const quotas = Object.fromEntries(Object.entries(quotaForm).map(([key, value]) => [key, Number(value)])) as PlatformSettings['quotas']
    if (Object.values(quotas).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      onAction(t('settings.quotas.invalid'))
      return
    }
    setQuotaSaving(true)
    try {
      onSettingsChange(await updatePlatformSettings({ ...settings, quotas }))
      onAction(t('settings.quotas.saved'))
    } catch {
      onAction(t('settings.quotas.saveFailed'))
    } finally {
      setQuotaSaving(false)
    }
  }
  const updateQuota = (key: keyof typeof quotaForm, value: string) => setQuotaForm((current) => ({ ...current, [key]: value }))
  const goToSection = (section: string) => {
    setActiveSection(section)
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return <div className="settings-layout"><div className="settings-nav"><button className={activeSection === 'cloudflare' ? 'selected' : ''} onClick={() => goToSection('cloudflare')} aria-current={activeSection === 'cloudflare' ? 'page' : undefined}><Cloud size={15} />Cloudflare</button><button className={activeSection === 'oauth' ? 'selected' : ''} onClick={() => goToSection('oauth')} aria-current={activeSection === 'oauth' ? 'page' : undefined}><KeyRound size={15} />{t('settings.nav.oauth')}</button><button className={activeSection === 'invites' ? 'selected' : ''} onClick={() => goToSection('invites')} aria-current={activeSection === 'invites' ? 'page' : undefined}><Users size={15} />{t('settings.nav.invites')}</button><button className={activeSection === 'smtp' ? 'selected' : ''} onClick={() => goToSection('smtp')} aria-current={activeSection === 'smtp' ? 'page' : undefined}><FileText size={15} />{t('settings.nav.smtp')}</button><button className={activeSection === 'maintenance' ? 'selected' : ''} onClick={() => goToSection('maintenance')} aria-current={activeSection === 'maintenance' ? 'page' : undefined}><ShieldCheck size={15} />{t('settings.nav.maintenance')}</button></div><div className="settings-content"><div id="settings-cloudflare" className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Cloud size={18} /></div><div><h2>{t('settings.cloudflare.title')}</h2><p>{t('settings.cloudflare.description')}</p></div><StatusBadge tone={cloudflareSettings?.configured ? 'success' : 'neutral'}>{cloudflareSettings?.configured ? t('settings.cloudflare.authorized') : cloudflareSettings ? t('settings.cloudflare.notConfigured') : apiLive ? t('settings.cloudflare.loadFailed') : t('settings.cloudflare.disconnected')}</StatusBadge></div><div className="form-grid"><label>{t('settings.cloudflare.accountId')}<input value={cloudflareSettings?.accountId ?? ''} placeholder={cloudflareSettings?.configured ? t('settings.cloudflare.waitingAccount') : t('settings.cloudflare.notConnected')} disabled /></label><label>{t('settings.cloudflare.authStatus')}<input value={cloudflareSettings?.configured ? (cloudflareSettings.accountIdConfigured ? t('settings.cloudflare.oauthDone') : t('settings.cloudflare.oauthMissingAccount')) : ''} placeholder={cloudflareSettings ? t('settings.cloudflare.waitingAdmin') : t('settings.cloudflare.loading')} disabled /></label></div><div className="settings-actions"><button className="button primary" onClick={startCloudflareAuth} disabled={!cloudflareSettings}>{cloudflareSettings?.configured ? t('settings.cloudflare.reauthorize') : t('settings.cloudflare.start')} <ArrowUpRight size={14} /></button>{cloudflareSettings?.configured && <button className="button secondary" onClick={revokeCloudflare}>{t('settings.cloudflare.revoke')}</button>}<span className="form-hint"><LockKeyhole size={13} />{t('settings.cloudflare.hint')}</span></div></div><div id="settings-oauth"><OauthPanel settings={oauthSettings} onChange={onOauthChange} onAction={onAction} /></div><div id="settings-invites"><InvitePanel invites={invites} onChange={onInvitesChange} onAction={onAction} /></div><div id="settings-smtp"><SmtpPanel settings={smtpSettings} onChange={onSmtpChange} onAction={onAction} /></div><div id="settings-maintenance" className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><ShieldCheck size={18} /></div><div><h2>{t('settings.maintenance.title')}</h2><p>{settings ? t('settings.maintenance.description') : t('settings.maintenance.descriptionOffline')}</p></div><StatusBadge tone={maintenance ? 'warning' : settings ? 'success' : 'neutral'}>{maintenance ? t('settings.maintenance.on') : settings ? t('settings.maintenance.off') : t('settings.maintenance.unknown')}</StatusBadge></div><div className="maintenance-row"><div><strong>{settings ? (maintenance ? t('settings.maintenance.pause') : t('settings.maintenance.allow')) : t('settings.maintenance.unknownTitle')}</strong><span>{settings ? (maintenance ? t('settings.maintenance.pauseBody') : t('settings.maintenance.allowBody')) : t('settings.maintenance.unknownBody')}</span></div><button className={`toggle ${settings && !maintenance ? 'on' : ''}`} disabled={saving || !settings} onClick={toggleMaintenance}><span /></button></div><div className="quota-form domain-form"><div className="form-grid"><label>{t('settings.domainSuffix.label')}<input value={domainSuffix} onChange={(event) => setDomainSuffix(event.target.value)} placeholder="plugins.example.com" disabled={!settings || suffixSaving} /></label></div><div className="settings-actions quota-actions"><span className="form-hint">{t('settings.domainSuffix.hint')}</span><button className="button secondary" onClick={() => void saveDomainSuffix()} disabled={!settings || suffixSaving || quotaSaving}>{suffixSaving ? t('common.saving') : t('settings.domainSuffix.save')}<Check size={14} /></button></div></div><div className="quota-form"><div className="form-grid"><label>{t('settings.quotas.requests')}<input type="number" min="1" step="1" value={quotaForm.requests} onChange={(event) => updateQuota('requests', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.connections')}<input type="number" min="1" step="1" value={quotaForm.activeConnections} onChange={(event) => updateQuota('activeConnections', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.r2Bytes')}<input type="number" min="1" step="1" value={quotaForm.r2Bytes} onChange={(event) => updateQuota('r2Bytes', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.r2Objects')}<input type="number" min="1" step="1" value={quotaForm.r2Objects} onChange={(event) => updateQuota('r2Objects', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.d1')}<input type="number" min="1" step="1" value={quotaForm.d1Queries} onChange={(event) => updateQuota('d1Queries', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.kv')}<input type="number" min="1" step="1" value={quotaForm.kvOperations} onChange={(event) => updateQuota('kvOperations', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.durableObjects')}<input type="number" min="1" step="1" value={quotaForm.durableObjectRequests} onChange={(event) => updateQuota('durableObjectRequests', event.target.value)} disabled={!settings || quotaSaving} /></label></div><div className="settings-actions quota-actions"><span className="form-hint">{t('settings.quotas.hint')}</span><button className="button secondary" onClick={() => void saveQuotas()} disabled={!settings || quotaSaving || suffixSaving}>{quotaSaving ? t('common.saving') : t('settings.quotas.save')}<Check size={14} /></button></div></div></div></div></div>
}

function OauthPanel({ settings, onChange, onAction }: { settings: OauthSettings | null; onChange: (settings: OauthSettings) => void; onAction: (message: string) => void }) {
  const { t } = useTranslation()
  const [github, setGithub] = useState({ clientId: '', clientSecret: '', redirectUri: '', allowlist: '' })
  const [cloudflare, setCloudflare] = useState({ clientId: '', clientSecret: '', redirectUri: '', scope: '' })
  const [saving, setSaving] = useState<OauthProvider | null>(null)
  useEffect(() => {
    if (!settings) return
    setGithub({ clientId: settings.github.clientId ?? '', clientSecret: '', redirectUri: settings.github.redirectUri ?? '', allowlist: settings.github.allowlist ?? '' })
    setCloudflare({ clientId: settings.cloudflare.clientId ?? '', clientSecret: '', redirectUri: settings.cloudflare.redirectUri ?? '', scope: settings.cloudflare.scope ?? '' })
  }, [settings])
  const sourceLabel = (source: OauthSettings['github']['source']) => source === 'database' ? t('settings.oauth.sourceDatabase') : source === 'environment' ? t('settings.oauth.sourceEnvironment') : t('settings.oauth.sourceNone')
  const sourceTone = (source: OauthSettings['github']['source']) => source === 'database' ? 'success' : source === 'environment' ? 'warning' : 'neutral'
  const save = async (provider: OauthProvider) => {
    if (!settings) return onAction(t('settings.oauth.notConnected'))
    setSaving(provider)
    try {
      const next = provider === 'github'
        ? await updateOauthSettings({ github: { clientId: github.clientId, clientSecret: github.clientSecret, redirectUri: github.redirectUri, allowlist: github.allowlist } })
        : await updateOauthSettings({ cloudflare: { clientId: cloudflare.clientId, clientSecret: cloudflare.clientSecret, redirectUri: cloudflare.redirectUri, scope: cloudflare.scope } })
      onChange(next)
      if (provider === 'github') setGithub((current) => ({ ...current, clientSecret: '' }))
      else setCloudflare((current) => ({ ...current, clientSecret: '' }))
      onAction(t('settings.oauth.saved'))
    } catch {
      onAction(t('settings.oauth.saveFailed'))
    } finally {
      setSaving(null)
    }
  }
  const reset = async (provider: OauthProvider) => {
    if (!window.confirm(t('settings.oauth.resetConfirm', { provider: provider === 'github' ? t('settings.oauth.githubTitle') : t('settings.oauth.cloudflareTitle') }))) return
    setSaving(provider)
    try {
      onChange(await revokeOauthSettings(provider))
      onAction(t('settings.oauth.resetDone'))
    } catch {
      onAction(t('settings.oauth.resetFailed'))
    } finally {
      setSaving(null)
    }
  }
  return <div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><KeyRound size={18} /></div><div><h2>{t('settings.oauth.title')}</h2><p>{t('settings.oauth.description')}</p></div><StatusBadge tone={settings ? (settings.github.configured || settings.cloudflare.configured ? 'success' : 'neutral') : 'neutral'}>{settings ? t('settings.oauth.configuredCount', { count: Number(settings.github.configured) + Number(settings.cloudflare.configured) }) : t('settings.oauth.unknown')}</StatusBadge></div>{settings?.unreadable && <div className="notice-bar compact oauth-notice"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('settings.oauth.unreadable')}</strong></div></div>}{settings && !settings.sessionSecretConfigured && <div className="notice-bar compact oauth-notice"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>{t('settings.oauth.sessionSecretMissing')}</strong></div></div>}<div className="oauth-block"><div className="oauth-block-heading"><div><h3>{t('settings.oauth.githubTitle')}</h3><p>{t('settings.oauth.githubDescription')}</p></div><StatusBadge tone={sourceTone(settings?.github.source ?? null)}>{sourceLabel(settings?.github.source ?? null)}</StatusBadge></div><div className="form-grid"><label>{t('settings.oauth.clientId')}<input value={github.clientId} onChange={(event) => setGithub((current) => ({ ...current, clientId: event.target.value }))} placeholder="Iv1.0123456789abcdef" disabled={!settings || saving !== null} /></label><label>{t('settings.oauth.clientSecret')}<input type="password" value={github.clientSecret} onChange={(event) => setGithub((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={settings?.github.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={!settings || saving !== null} /></label><label>{t('settings.oauth.redirectUri')}<input value={github.redirectUri} onChange={(event) => setGithub((current) => ({ ...current, redirectUri: event.target.value }))} placeholder={`${window.location.origin}/auth/github/callback`} disabled={!settings || saving !== null} /></label><label>{t('settings.oauth.allowlist')}<input value={github.allowlist} onChange={(event) => setGithub((current) => ({ ...current, allowlist: event.target.value }))} placeholder="octocat, admin@example.com" disabled={!settings || saving !== null} /></label></div><p className="form-hint">{t('settings.oauth.allowlistHint')}</p><div className="settings-actions"><button className="button primary" onClick={() => void save('github')} disabled={!settings || saving !== null}>{saving === 'github' ? t('common.saving') : t('settings.oauth.save')}<Check size={14} /></button>{settings?.github.source === 'database' && <button className="button secondary" onClick={() => void reset('github')} disabled={saving !== null}>{t('settings.oauth.reset')}</button>}</div></div><div className="oauth-block"><div className="oauth-block-heading"><div><h3>{t('settings.oauth.cloudflareTitle')}</h3><p>{t('settings.oauth.cloudflareDescription')}</p></div><StatusBadge tone={sourceTone(settings?.cloudflare.source ?? null)}>{sourceLabel(settings?.cloudflare.source ?? null)}</StatusBadge></div><div className="form-grid"><label>{t('settings.oauth.clientId')}<input value={cloudflare.clientId} onChange={(event) => setCloudflare((current) => ({ ...current, clientId: event.target.value }))} disabled={!settings || saving !== null} /></label><label>{t('settings.oauth.clientSecret')}<input type="password" value={cloudflare.clientSecret} onChange={(event) => setCloudflare((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={settings?.cloudflare.secretConfigured ? t('settings.oauth.secretPlaceholder') : t('settings.oauth.secretPlaceholderNew')} disabled={!settings || saving !== null} /></label><label>{t('settings.oauth.redirectUri')}<input value={cloudflare.redirectUri} onChange={(event) => setCloudflare((current) => ({ ...current, redirectUri: event.target.value }))} placeholder={`${window.location.origin}/auth/cloudflare/callback`} disabled={!settings || saving !== null} /></label><label>{t('settings.oauth.scope')}<input value={cloudflare.scope} onChange={(event) => setCloudflare((current) => ({ ...current, scope: event.target.value }))} disabled={!settings || saving !== null} /></label></div><div className="settings-actions"><button className="button primary" onClick={() => void save('cloudflare')} disabled={!settings || saving !== null}>{saving === 'cloudflare' ? t('common.saving') : t('settings.oauth.save')}<Check size={14} /></button>{settings?.cloudflare.source === 'database' && <button className="button secondary" onClick={() => void reset('cloudflare')} disabled={saving !== null}>{t('settings.oauth.reset')}</button>}</div></div></div>
}

function InvitePanel({ invites, onChange, onAction }: { invites: ApiInvite[] | null; onChange: (invites: ApiInvite[]) => void; onAction: (message: string) => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [githubLogin, setGithubLogin] = useState('')
  const [expiresInHours, setExpiresInHours] = useState('72')
  const [saving, setSaving] = useState(false)
  const [latestUrl, setLatestUrl] = useState<string | null>(null)

  const refresh = async () => onChange(await fetchInvites())
  const create = async () => {
    if (!email.trim() && !githubLogin.trim()) {
      onAction(t('settings.invite.identityRequired'))
      return
    }
    setSaving(true)
    try {
      const result = await createInvite({ email: email.trim() || undefined, githubLogin: githubLogin.trim() || undefined, expiresInHours: Number(expiresInHours) || 72 })
      setLatestUrl(result.inviteUrl)
      setEmail('')
      setGithubLogin('')
      await refresh()
      onAction(result.emailSent === false && email.trim() ? t('settings.invite.createdEmailFailed') : t('settings.invite.created'))
    } catch (error) {
      onAction(errorMessage(error, 'settings.invite.createFailed'))
    } finally {
      setSaving(false)
    }
  }
  const revoke = async (invite: ApiInvite) => {
    if (!window.confirm(t('settings.invite.revokeConfirm'))) return
    try {
      await revokeInvite(invite.id)
      await refresh()
      onAction(t('settings.invite.revoked'))
    } catch (error) {
      onAction(errorMessage(error, 'settings.invite.revokeFailed'))
    }
  }
  const copy = async () => {
    if (!latestUrl) return
    await navigator.clipboard.writeText(latestUrl)
    onAction(t('settings.invite.copied'))
  }
  return <div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Users size={18} /></div><div><h2>{t('settings.invite.title')}</h2><p>{invites ? t('settings.invite.description') : t('settings.invite.descriptionUnavailable')}</p></div><StatusBadge tone={invites ? 'success' : 'neutral'}>{invites ? t('settings.invite.count', { count: invites.length }) : t('settings.invite.unknown')}</StatusBadge></div><div className="form-grid"><label>{t('settings.invite.email')}<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={!invites || saving} /></label><label>{t('settings.invite.github')}<input value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="github-login" disabled={!invites || saving} /></label><label>{t('settings.invite.expiresIn')}<input type="number" min="1" max="720" value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} disabled={!invites || saving} /></label></div><div className="settings-actions"><button className="button primary" onClick={() => void create()} disabled={!invites || saving}>{t('settings.invite.create')}<Plus size={14} /></button>{latestUrl && <><input className="invite-url" value={latestUrl} readOnly aria-label={t('settings.invite.newLink')} /><button className="button secondary" onClick={() => void copy()}><Copy size={14} />{t('settings.invite.copy')}</button></>}</div>{invites === null ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>{t('settings.invite.emptyTitle')}</h3><p>{t('settings.invite.emptyBody')}</p></div> : invites.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>{t('settings.invite.noInvitesTitle')}</h3><p>{t('settings.invite.noInvitesBody')}</p></div> : <div className="table-wrap"><table><thead><tr><th>{t('settings.invite.columnIdentity')}</th><th>{t('settings.invite.columnStatus')}</th><th>{t('settings.invite.columnExpires')}</th><th /></tr></thead><tbody>{invites.map((invite) => <tr key={invite.id}><td><div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{invite.github_login || invite.email || t('settings.invite.noIdentity')}</strong><small>{invite.email || t('settings.invite.noEmail')}</small></div></div></td><td><StatusBadge tone={invite.status === 'pending' ? 'warning' : invite.status === 'used' ? 'success' : 'neutral'}>{t(`status.${invite.status}`, { defaultValue: invite.status })}</StatusBadge></td><td>{formatDateTime(invite.expires_at)}</td><td>{invite.status === 'pending' && <button className="row-action" onClick={() => void revoke(invite)} aria-label={t('settings.invite.revoke')} title={t('settings.invite.revoke')}><X size={15} /></button>}</td></tr>)}</tbody></table></div>}</div>
}

function SmtpPanel({ settings, onChange, onAction }: { settings: SmtpSettings | null; onChange: (settings: SmtpSettings) => void; onAction: (message: string) => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ host: '', port: '587', secure: false, username: '', password: '', authType: 'plain' as 'plain' | 'login' | 'cram-md5', from: '', fromName: '', replyTo: '', testTo: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    if (!settings?.configured) return
    setForm((current) => ({ ...current, host: settings.host ?? '', port: String(settings.port ?? 587), secure: settings.secure ?? false, username: settings.username ?? '', authType: settings.authType ?? 'plain', from: settings.from ?? '', fromName: settings.fromName ?? '', replyTo: settings.replyTo ?? '' }))
  }, [settings])
  const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (!settings) return onAction(t('settings.smtp.notConnectedSave'))
    setSaving(true)
    try {
      onChange(await updateSmtpSettings({ host: form.host, port: Number(form.port), secure: form.secure, username: form.username, password: form.password, authType: form.authType, from: form.from, fromName: form.fromName, replyTo: form.replyTo }))
      update('password', '')
      onAction(t('settings.smtp.saved'))
    } catch { onAction(t('settings.smtp.saveFailed')) } finally { setSaving(false) }
  }
  const test = async () => {
    if (!settings) return onAction(t('settings.smtp.notConnectedTest'))
    setTesting(true)
    try { await sendSmtpTest(form.testTo); onAction(t('settings.smtp.sent')) } catch { onAction(t('settings.smtp.sendFailed')) } finally { setTesting(false) }
  }
  return <div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Mail size={18} /></div><div><h2>{t('settings.smtp.title')}</h2><p>{settings ? t('settings.smtp.description') : t('settings.smtp.descriptionUnavailable')}</p></div><StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? t('settings.smtp.configured') : settings ? t('settings.smtp.notConfigured') : t('settings.smtp.unknown')}</StatusBadge></div><div className="form-grid"><label>{t('settings.smtp.host')}<input value={form.host} onChange={(event) => update('host', event.target.value)} placeholder="smtp.example.com" disabled={!settings} /></label><label>{t('settings.smtp.port')}<input type="number" min="1" max="65535" value={form.port} onChange={(event) => update('port', event.target.value)} disabled={!settings} /></label><label>{t('settings.smtp.username')}<input value={form.username} onChange={(event) => update('username', event.target.value)} disabled={!settings} /></label><label>{t('settings.smtp.password')}<input type="password" value={form.password} onChange={(event) => update('password', event.target.value)} placeholder={settings?.configured ? t('settings.smtp.passwordPlaceholder') : t('settings.smtp.passwordPlaceholderNew')} disabled={!settings} /></label><label>{t('settings.smtp.authType')}<select value={form.authType} onChange={(event) => update('authType', event.target.value)} disabled={!settings}><option value="plain">PLAIN</option><option value="login">LOGIN</option><option value="cram-md5">CRAM-MD5</option></select></label><label>{t('settings.smtp.from')}<input type="email" value={form.from} onChange={(event) => update('from', event.target.value)} placeholder="noreply@example.com" disabled={!settings} /></label><label>{t('settings.smtp.fromName')}<input value={form.fromName} onChange={(event) => update('fromName', event.target.value)} disabled={!settings} /></label><label>{t('settings.smtp.replyTo')}<input type="email" value={form.replyTo} onChange={(event) => update('replyTo', event.target.value)} disabled={!settings} /></label></div><div className="smtp-options"><label className="check-row"><input type="checkbox" checked={form.secure} onChange={(event) => update('secure', event.target.checked)} disabled={!settings} />{t('settings.smtp.secure')}</label><span className="form-hint">{t('settings.smtp.hint')}</span></div><div className="settings-actions"><button className="button primary" onClick={save} disabled={saving || !settings}>{saving ? t('common.saving') : t('settings.smtp.save')}<Check size={14} /></button><div className="smtp-test"><input value={form.testTo} onChange={(event) => update('testTo', event.target.value)} placeholder={t('settings.smtp.testPlaceholder')} disabled={!settings} /><button className="button secondary" onClick={test} disabled={testing || !settings}>{testing ? t('common.sending') : t('settings.smtp.sendTest')}<ArrowUpRight size={14} /></button></div></div></div>
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal detail-modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2><p>{t('detail.subtitle')}</p></div><IconButton label={t('detail.close')} onClick={onClose}><X size={17} /></IconButton></div>{loading && <div className="detail-loading"><RefreshCw size={18} className="spin" />{t('detail.loading')}</div>}{error && <div className="auth-error"><AlertCircle size={14} />{translateError(error)}</div>}{!loading && !error && data?.kind === 'server' && <ServerDetailContent value={data.value} onOpenPlugin={onOpenPlugin} />}{!loading && !error && data?.kind === 'plugin' && <PluginDetailContent value={data.value} healthLoading={healthLoading} actionLoading={actionLoading} onHealth={onHealth} onAction={onAction} />}</div></div>
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

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}><div className="modal" role="dialog" aria-modal="true" aria-label={content.title}><div className="modal-head"><div><h2>{content.title}</h2><p>{content.description}</p></div><IconButton label={t('modal.close')} onClick={onClose}><X size={17} /></IconButton></div>{result?.kind === 'registration' && <div className="code-callout"><span>{t('modal.codeExpires', { time: formatDateTime(result.expiresAt) })}</span><div className="code-value"><strong>{result.code}</strong><button className="row-action" onClick={() => void copyCode(result.code)} aria-label={t('modal.copyCode')} title={t('modal.copyCode')}><Copy size={15} /></button></div></div>}{result?.kind === 'plugin' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>{t('modal.loadConfirmed')}</h3><p>{t('modal.loadConfirmedState', { state: result.state })}</p></div>}{result?.kind === 'domain' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>{t('modal.domainAssigned')}</h3><p>{result.hostname}</p></div>}{!result && type === 'server' && <div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>{t('modal.generateCode')}</h3><p>{t('modal.codeHint')}</p></div>}{!result && type !== 'server' && <>{candidates.length > 0 ? <label className="modal-field">{t('modal.pluginInstance')}<select autoFocus value={selectedPluginId} onChange={(event) => setSelectedPluginId(event.target.value)}><option value="">{t('modal.selectPlugin')}</option>{candidates.map((plugin) => <option value={plugin.id} key={plugin.id}>{plugin.name} · {plugin.plugin_id} · {plugin.server_name}</option>)}</select></label> : <div className="empty-panel"><div className="empty-illustration"><AlertCircle size={22} /></div><h3>{type === 'plugin' ? t('modal.noLoadable') : t('modal.noAssignable')}</h3><p>{type === 'plugin' ? t('modal.noLoadableHint') : t('modal.noAssignableHint')}</p></div>}{type === 'domain' && candidates.length > 0 && <label className="modal-field">{t('modal.prefix')}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={t('modal.prefixPlaceholder')} maxLength={48} /><span className="field-hint">{t('modal.prefixHint')}</span></label>}</>}{error && <div className="auth-error"><AlertCircle size={14} />{translateError(error)}</div>}<div className="modal-actions"><button className="button secondary" onClick={onClose} disabled={submitting}>{t('modal.closeAction')}</button>{!result && <button className="button primary" onClick={() => void submit()} disabled={submitting || (type !== 'server' && (!selectedPluginId || candidates.length === 0))}>{submitting ? t('common.submitting') : type === 'server' ? t('modal.submitServer') : type === 'domain' ? t('modal.submitDomain') : t('modal.submitPlugin')}<ArrowUpRight size={14} /></button>}</div></div></div>
}

export default App

createRoot(document.getElementById('root')!).render(<App />)
