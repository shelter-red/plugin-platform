import { useEffect, useMemo, useState } from 'react'
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
  ExternalLink,
  FileText,
  Mail,
  Gauge,
  Globe2,
  HardDrive,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Moon,
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
import { assignDomain, commandPlugin, createInvite, createRegistrationCode, fetchAudit, fetchCloudflareSettings, fetchCloudflareUsage, fetchDomains, fetchInvites, fetchLocalUsage, fetchOverview, fetchPlatformSettings, fetchPlugins, fetchServers, fetchSmtpSettings, revokeCloudflareSettings, revokeInvite, type ApiAudit, type ApiDomain, type ApiInvite, type ApiOverview, type ApiPlugin, type ApiServer, type CloudflareSettings, type CloudflareUsage, type LocalUsage, type PlatformSettings, type SmtpSettings, sendSmtpTest, updatePlatformSettings, updateSmtpSettings } from './api'

type Page = 'overview' | 'servers' | 'plugins' | 'domains' | 'usage' | 'audit' | 'settings'
type Theme = 'dark' | 'light' | 'system'
type ModalInput = { prefix?: string; pluginInstanceId?: string }
type ModalResult = { kind: 'registration'; code: string; expiresAt: string } | { kind: 'plugin'; state: string } | { kind: 'domain'; hostname: string }

const pageMeta: Record<Page, { title: string; description: string }> = {
  overview: { title: '总览', description: '查看平台连接、插件实例和公开入口的运行状态。' },
  servers: { title: '插件服务器', description: '管理出站连接、服务器注册和本地运行状态。' },
  plugins: { title: '插件实例', description: '从已连接的服务器发现、加载并启用插件。' },
  domains: { title: '公开域名', description: '为已通过健康检查的插件分配公开访问入口。' },
  usage: { title: '用量与配额', description: '查看 Cloudflare 官方数据与平台本地计数。' },
  audit: { title: '审计日志', description: '追踪邀请、绑定、密钥和插件生命周期变更。' },
  settings: { title: '系统设置', description: '配置 Cloudflare 授权、邮件通知和全局维护状态。' },
}

const navGroups: { label: string; items: { id: Page; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: '主菜单',
    items: [
      { id: 'overview', label: '总览', icon: LayoutDashboard },
      { id: 'servers', label: '插件服务器', icon: Server },
      { id: 'plugins', label: '插件实例', icon: Box },
      { id: 'domains', label: '公开域名', icon: Globe2 },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'usage', label: '用量与配额', icon: Gauge },
      { id: 'audit', label: '审计日志', icon: FileText },
      { id: 'settings', label: '系统设置', icon: Settings },
    ],
  },
]

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function AuthLoading() {
  return <div className="auth-screen"><div className="auth-card"><div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div><h1>正在检查登录状态</h1><p>请稍候，Plugmesh 正在验证当前会话。</p><div className="loading-line" /></div></div>
}

function LoginPage() {
  const invite = new URLSearchParams(window.location.search).get('invite')
  const authError = new URLSearchParams(window.location.search).get('auth_error')
  const startUrl = `/auth/github/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div><div><strong>Plugmesh</strong><span>插件平台</span></div></div><div className="auth-icon"><Code2 size={22} /></div><h1>{invite ? '接受平台邀请' : '登录 Plugmesh'}</h1><p>{invite ? '使用受邀的 GitHub 身份继续，平台会在登录后完成身份匹配。' : '管理插件服务器、插件实例和公开域名。平台不开放自助注册。'}</p>{authError && <div className="auth-error"><AlertCircle size={14} />{authError}</div>}<a className="github-button" href={startUrl}><Code2 size={16} />使用 GitHub 登录<ArrowUpRight size={14} /></a><span className="auth-note"><LockKeyhole size={13} />登录状态由 HttpOnly 会话 cookie 保护</span></div></div>
}

function StatusBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  return <span className={`status-badge ${tone}`}><span className="status-dot" />{children}</span>
}

function App() {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true'
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'anonymous'>(authEnabled ? 'loading' : 'authenticated')
  const [authUser, setAuthUser] = useState<{ display_name: string; email: string; role?: string } | null>(null)
  const [overview, setOverview] = useState<ApiOverview | null>(null)
  const [servers, setServers] = useState<ApiServer[] | null>(null)
  const [plugins, setPlugins] = useState<ApiPlugin[] | null>(null)
  const [domains, setDomains] = useState<ApiDomain[] | null>(null)
  const [audits, setAudits] = useState<ApiAudit[] | null>(null)
  const [invites, setInvites] = useState<ApiInvite[] | null>(null)
  const [usage, setUsage] = useState<CloudflareUsage | null>(null)
  const [localUsage, setLocalUsage] = useState<LocalUsage | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null)
  const [cloudflareSettings, setCloudflareSettings] = useState<CloudflareSettings | null>(null)
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null)
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
  const [toast, setToast] = useState<string | null>(null)
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d')

  const meta = pageMeta[page]
  const themeLabel = theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '系统'
  const effectiveTheme = theme === 'system' ? systemTheme : theme

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
    const params = new URLSearchParams(window.location.search)
    const result = params.get('cloudflare')
    const error = params.get('cloudflare_error')
    if (result === 'connected') setToast('Cloudflare 已授权并识别账号')
    if (result === 'connected_without_account') setToast('Cloudflare 已授权，但未识别唯一账号')
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
    }).catch(() => setDataError('Worker 数据暂时无法读取')).finally(() => setDataLoading(false))
  }, [authEnabled])

  useEffect(() => {
    if (!authEnabled && !import.meta.env.VITE_API_BASE) return
    setAuditLoading(true)
    fetchAudit().then((data) => {
      setAudits(data)
      setAuditError(null)
    }).catch(() => setAuditError('审计日志暂时无法读取')).finally(() => setAuditLoading(false))
    setUsageLoading(true)
    fetchCloudflareUsage().then((data) => {
      setUsage(data)
      setUsageError(null)
    }).catch((error) => {
      setUsage(null)
      setUsageError(error instanceof Error ? error.message : 'Cloudflare 用量暂时无法读取')
    }).finally(() => setUsageLoading(false))
    fetchLocalUsage().then(setLocalUsage).catch(() => setLocalUsage(null))
  }, [authEnabled])

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
      const [nextOverview, nextServers, nextPlugins, nextDomains] = await Promise.all([fetchOverview(), fetchServers(), fetchPlugins(), fetchDomains()])
      setOverview(nextOverview)
      setServers(nextServers)
      setPlugins(nextPlugins)
      setDomains(nextDomains)
      setApiLive(true)
      setDataError(null)
      if (notify) showToast('平台数据已刷新')
    } catch {
      setDataError('Worker 数据暂时无法读取')
      showToast('平台数据刷新失败')
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
    if (!input.pluginInstanceId) throw new Error('请选择插件实例')
    if (type === 'plugin') {
      const result = await commandPlugin(input.pluginInstanceId, 'load')
      await refreshData(false)
      return { kind: 'plugin', state: result.state }
    }
    if (!input.prefix?.trim()) throw new Error('请输入域名前缀')
    const result = await assignDomain(input.pluginInstanceId, input.prefix.trim())
    await refreshData(false)
    return { kind: 'domain', hostname: result.hostname }
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

  if (authEnabled && authState === 'loading') return <AuthLoading />
  if (authEnabled && authState === 'anonymous') return <LoginPage />

  return (
    <div className={`app-shell theme-${effectiveTheme}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div>
          <div><div className="brand-name">Plugmesh</div><div className="brand-caption">插件平台</div></div>
          <IconButton label="关闭导航" onClick={() => setSidebarOpen(false)}><X size={17} /></IconButton>
        </div>
        <div className="workspace-switcher"><div className="workspace-icon">P</div><div className="workspace-copy"><strong>平台工作区</strong><span>等待 Worker 数据</span></div><ChevronDown size={14} /></div>
        <nav className="nav-area">
          {navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(({ id, label, icon: NavIcon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => selectPage(id)}><NavIcon size={16} /><span>{label}</span>{id === 'servers' && servers && servers.length > 0 && <span className="nav-count">{servers.length}</span>}</button>)}</div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-link"><CircleHelp size={15} /><span>帮助与协议</span><ExternalLink size={12} /></div>
          <div className="user-card"><div className="avatar">{(authUser?.display_name ?? '—').slice(0, 2).toUpperCase()}</div><div className="user-copy"><strong>{authUser?.display_name ?? '未读取用户'}</strong><span>{authUser?.email ?? '未读取身份'}</span></div><MoreHorizontal size={16} /></div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-leading"><IconButton label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={18} /></IconButton><div className="breadcrumbs"><span>控制台</span><span>/</span><strong>{meta.title}</strong></div></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索插件、域名..." /><span className="shortcut"><Command size={11} /> K</span></label>
            <div className="theme-menu"><IconButton label={`主题：${themeLabel}`}><Sun size={16} /><ChevronDown size={11} /></IconButton><select aria-label="选择主题" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="dark">深色</option><option value="light">浅色</option><option value="system">系统</option></select></div>
            <IconButton label="通知"><Activity size={16} /></IconButton>
            <div className="top-avatar">AD</div>
          </div>
        </header>
        <div className="page-scroll">
          <div className="page-content">
            <div className="page-header"><div><div className="eyebrow"><span className="live-pulse" />{apiLive ? '实时数据' : '等待真实数据'}</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="header-actions">{page === 'overview' && <button className="button secondary" onClick={() => void refreshData()} disabled={dataLoading}><RefreshCw size={15} />刷新状态</button>}{page === 'servers' && <button className="button primary" onClick={() => setModal('server')}><Plus size={16} />绑定服务器</button>}{page === 'domains' && <button className="button primary" onClick={() => setModal('domain')}><Plus size={16} />分配域名</button>}{page === 'plugins' && <button className="button primary" onClick={() => setModal('plugin')}><Plus size={16} />加载插件</button>}</div></div>
            {dataError && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>数据读取失败</strong><span>{dataError}</span></div><button onClick={() => void refreshData()}>重试 <RefreshCw size={14} /></button></div>}
            {page === 'overview' && <Overview overview={overview} audits={audits ?? []} range={range} setRange={setRange} onNavigate={selectPage} />}
            {page === 'servers' && <Servers servers={servers ?? []} loading={dataLoading} onAction={showToast} onBind={() => setModal('server')} />}
            {page === 'plugins' && <Plugins plugins={filteredPlugins} loading={dataLoading} onAction={showToast} onLoad={() => setModal('plugin')} />}
            {page === 'domains' && <Domains domains={domains ?? []} loading={dataLoading} onAction={showToast} onAssign={() => setModal('domain')} />}
            {page === 'usage' && <Usage settings={platformSettings} usage={usage} localUsage={localUsage} loading={usageLoading} error={usageError} onNavigate={selectPage} />}
            {page === 'audit' && <Audit audits={audits ?? []} loading={auditLoading} error={auditError} />}
            {page === 'settings' && <SettingsPage settings={platformSettings} onSettingsChange={setPlatformSettings} cloudflareSettings={cloudflareSettings} onCloudflareChange={setCloudflareSettings} smtpSettings={smtpSettings} onSmtpChange={setSmtpSettings} invites={invites} onInvitesChange={setInvites} onAction={showToast} />}
          </div>
        </div>
      </main>
      {modal && <Modal type={modal} plugins={plugins ?? []} onClose={() => setModal(null)} onConfirm={(input) => confirmModal(modal, input)} />}
      {toast && <div className="toast"><div className="toast-icon"><Check size={14} /></div>{toast}</div>}
    </div>
  )
}

function Overview({ overview, audits, range, setRange, onNavigate }: { overview: ApiOverview | null; audits: ApiAudit[]; range: '24h' | '7d' | '30d'; setRange: (value: '24h' | '7d' | '30d') => void; onNavigate: (page: Page) => void }) {
  const onlineServers = overview ? String(overview.onlineServers) : '—'
  const enabledPlugins = overview ? String(overview.enabledPlugins) : '—'
  const domains = overview ? String(overview.domains) : '—'
  return <>
    <div className="notice-bar"><div className="notice-icon"><ShieldCheck size={16} /></div><div><strong>{overview ? '平台数据已连接' : '等待 Worker 数据'}</strong><span>{overview ? '以下统计来自当前用户的 Worker API。' : '登录并连接 Worker API 后，这里会显示真实的平台状态。'}</span></div><button onClick={() => onNavigate('settings')}>配置平台 <ArrowUpRight size={14} /></button></div>
    <section className="metric-grid">
      <Metric label="在线服务器" value={onlineServers} suffix="" note={overview ? '来自 Worker API' : '暂无数据'} icon={Server} tone="green" onClick={() => onNavigate('servers')} />
      <Metric label="已启用插件" value={enabledPlugins} suffix="" note={overview ? '来自 Worker API' : '暂无数据'} icon={Box} tone="blue" onClick={() => onNavigate('plugins')} />
      <Metric label="公开域名" value={domains} suffix="" note={overview ? '来自 Worker API' : '暂无数据'} icon={Globe2} tone="purple" onClick={() => onNavigate('domains')} />
      <Metric label="当前连接" value="—" suffix="" note="暂无本地连接计数" icon={Zap} tone="amber" onClick={() => onNavigate('usage')} />
    </section>
    <section className="content-grid two-thirds">
      <div className="panel chart-panel"><div className="panel-header"><div><h2>请求趋势</h2><p>接入真实用量数据后显示</p></div><div className="segmented">{(['24h', '7d', '30d'] as const).map((item) => <button className={range === item ? 'selected' : ''} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div><div className="empty-chart chart-empty-state"><Activity size={20} /><strong>暂无请求趋势数据</strong><span>当前 Worker 尚未返回趋势统计。</span></div></div>
      <div className="panel"><div className="panel-header"><div><h2>资源使用</h2><p>等待 Cloudflare Analytics 和本地计数</p></div><IconButton label="查看用量详情" onClick={() => onNavigate('usage')}><ArrowUpRight size={15} /></IconButton></div><div className="resource-list"><Resource label="Worker 请求" value="—" limit="未读取" icon={Cloud} /><Resource label="R2 中转容量" value="—" limit="未读取" icon={HardDrive} /><Resource label="D1 数据库" value="—" limit="未读取" icon={Database} /><Resource label="Durable Object" value="—" limit="未读取" icon={Activity} /></div><button className="text-link" onClick={() => onNavigate('usage')}>查看全部配额 <ArrowUpRight size={14} /></button></div>
    </section>
    <section className="content-grid two-thirds bottom-grid"><div className="panel"><div className="panel-header"><div><h2>最近活动</h2><p>最新平台事件与配置变化</p></div><button className="text-link" onClick={() => onNavigate('audit')}>查看审计日志 <ArrowUpRight size={14} /></button></div>{audits.length > 0 ? <div className="activity-list">{audits.slice(0, 3).map((item) => <div className="activity-item" key={item.id}><div className="activity-mark success"><Check size={13} /></div><div className="activity-copy"><strong>{auditActionLabel(item.action)}</strong><span>{auditDetail(item)}</span></div><time>{new Date(item.created_at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>暂无活动记录</h3><p>Worker 返回审计事件后会显示在这里。</p></div>}</div><div className="panel quick-panel"><div className="panel-header"><div><h2>快速开始</h2><p>完成平台接入需要三步</p></div></div><QuickStep number="01" title="绑定插件服务器" detail="安装本地服务器并输入注册码" onClick={() => onNavigate('servers')} /><QuickStep number="02" title="加载第一个插件" detail="同步 manifest 并完成健康检查" onClick={() => onNavigate('plugins')} /><QuickStep number="03" title="分配公开域名" detail="为插件选择唯一的子域名前缀" onClick={() => onNavigate('domains')} /></div></section>
  </>
}

function Metric({ label, value, suffix, note, icon: Icon, tone, onClick }: { label: string; value: string; suffix: string; note: string; icon: typeof Server; tone: string; onClick: () => void }) { return <button className="metric-card" onClick={onClick}><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div className="metric-label">{label}<ArrowUpRight size={13} /></div><div className="metric-number">{value}<small>{suffix}</small></div><div className="metric-note"><span className="status-dot green" />{note}</div></button> }
function Resource({ label, value, limit, icon: Icon }: { label: string; value: string; limit: string; icon: typeof Cloud }) { return <div className="resource"><div className="resource-top"><div className="resource-label"><Icon size={15} />{label}</div><strong>{value}</strong></div><div className="progress"><span style={{ width: 0 }} /></div><div className="resource-bottom"><span>当前用量</span><span>{limit}</span></div></div> }
function QuickStep({ number, title, detail, done, onClick }: { number: string; title: string; detail: string; done?: boolean; onClick: () => void }) { return <button className="quick-step" onClick={onClick}><span className={`step-number ${done ? 'done' : ''}`}>{done ? <Check size={13} /> : number}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></button> }

function capabilityLabel(plugin: ApiPlugin): string {
  try {
    const manifest = JSON.parse(plugin.manifest_json) as { capabilities?: Record<string, unknown> }
    const labels = [
      ['http', 'HTTP'],
      ['websocket', 'WebSocket'],
      ['sse', 'SSE'],
      ['fileStream', '文件流'],
    ].filter(([key]) => manifest.capabilities?.[key] === true).map(([, label]) => label)
    return labels.length > 0 ? labels.join(' + ') : '未声明能力'
  } catch {
    return 'manifest 无效'
  }
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'invite.created': '创建平台邀请',
    'server.registration_code.created': '生成服务器注册码',
    'server.registered': '插件服务器已注册',
    'plugin.load': '加载插件',
    'plugin.unload': '卸载插件',
    'plugin.enable': '启用插件',
    'plugin.disable': '停用插件',
    'plugin.reload': '重载插件',
    'domain.assigned': '分配公开域名',
    'platform.settings.updated': '更新平台设置',
    'smtp.settings.updated': '更新 SMTP 设置',
    'smtp.settings.revoked': '撤销 SMTP 设置',
    'smtp.test.sent': '发送 SMTP 测试邮件',
  }
  return labels[action] ?? action
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

function Servers({ servers, loading, onAction, onBind }: { servers: ApiServer[]; loading: boolean; onAction: (message: string) => void; onBind: () => void }) { return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>已绑定服务器</h2><p>每台服务器通过一条出站 WebSocket 连接平台。</p></div><button className="button secondary small" onClick={() => onAction(loading ? '正在读取服务器状态' : '请使用页面顶部刷新状态')} disabled={loading}><RefreshCw size={14} />刷新</button></div>{servers.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Server size={22} /></div><h3>暂无已绑定服务器</h3><p>生成一次性注册码，在服务器本地完成绑定后会显示在这里。</p></div> : <div className="server-list">{servers.map((server) => <div className="server-row" key={server.id}><div className="server-symbol"><Server size={18} /></div><div className="server-main"><strong>{server.name}</strong><span>{server.id} · 协议 v1</span></div><StatusBadge tone={server.status === 'online' ? 'success' : server.status === 'revoked' ? 'danger' : 'warning'}>{server.status === 'online' ? '在线' : server.status === 'revoked' ? '已撤销' : '离线'}</StatusBadge><div className="server-meta"><span>{server.last_seen_at ? `最近心跳 ${new Date(server.last_seen_at).toLocaleString('zh-CN')}` : '尚未连接'}</span><button className="row-action" onClick={() => onAction(`${server.name} 当前状态：${server.status}`)}><MoreHorizontal size={17} /></button></div></div>)}</div>}</div><div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>绑定新的插件服务器</h3><p>从管理端生成一次性注册码，在服务器本地 Web UI 中完成绑定。</p><button className="button primary" onClick={onBind}><Plus size={15} />生成注册码</button></div></div> }

function Plugins({ plugins, loading, onAction, onLoad }: { plugins: ApiPlugin[]; loading: boolean; onAction: (message: string) => void; onLoad: () => void }) { const enabled = plugins.filter((plugin) => plugin.state === 'enabled').length; return <div className="stack"><div className="filter-row"><div className="filter-summary"><span className="filter-dot" />已启用 {enabled} 个插件 <span className="divider" />共发现 {plugins.length} 个</div><button className="button secondary small" onClick={() => onAction(loading ? '正在读取插件状态' : 'manifest 会在服务器心跳时同步')} disabled={loading}><RefreshCw size={14} />同步 manifest</button></div>{plugins.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Code2 size={22} /></div><h3>暂无插件 manifest</h3><p>服务器连接并完成 manifest 同步后，插件会显示在这里。</p><button className="button primary" onClick={onLoad}><Plus size={15} />加载插件</button></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>插件</th><th>服务器</th><th>状态</th><th>能力</th><th>公开入口</th><th /></tr></thead><tbody>{plugins.map((plugin) => <tr key={plugin.id}><td><div className="cell-title"><div className="table-icon"><Code2 size={15} /></div><div><strong>{plugin.name}</strong><small>{plugin.plugin_id} · v{plugin.version}</small></div></div></td><td>{plugin.server_name}</td><td><StatusBadge tone={plugin.state === 'enabled' ? 'success' : plugin.state === 'failed' ? 'danger' : 'neutral'}>{plugin.state}</StatusBadge></td><td><span className="capability">{capabilityLabel(plugin)}</span></td><td>{plugin.domain_hostname ? <a href={`https://${plugin.domain_hostname}`} target="_blank" rel="noreferrer">{plugin.domain_hostname}</a> : <span className="muted">未分配</span>}</td><td><button className="row-action" onClick={() => onAction(`插件 ${plugin.name} 当前状态：${plugin.state}`)}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>显示 {plugins.length} 个插件</span><button className="text-link" onClick={onLoad}>加载插件 <Plus size={14} /></button></div></div>}</div> }

function Domains({ domains, loading, onAction, onAssign }: { domains: ApiDomain[]; loading: boolean; onAction: (message: string) => void; onAssign: () => void }) {
  const copyDomain = async (hostname: string) => {
    if (!navigator.clipboard) {
      onAction('当前浏览器不支持复制')
      return
    }
    try {
      await navigator.clipboard.writeText(hostname)
      onAction('公开域名已复制')
    } catch {
      onAction('公开域名复制失败')
    }
  }
  return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>公开入口</h2><p>插件域名由平台通配路由统一处理，无需逐个创建 DNS 记录。</p></div><button className="button secondary small" onClick={() => onAction(loading ? '正在读取域名状态' : '请使用页面顶部刷新状态')} disabled={loading}><RefreshCw size={14} />刷新</button></div>{domains.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>暂无公开域名</h3><p>为已启用并通过健康检查的插件分配唯一子域名。</p></div> : <div className="domain-list">{domains.map((domain) => <div className="domain-row" key={domain.id}><div className="domain-icon"><Globe2 size={17} /></div><div className="domain-main"><strong>{domain.hostname}</strong><span>{domain.plugin_name} · {domain.plugin_instance_id}</span></div><StatusBadge tone={domain.status === 'online' ? 'success' : 'warning'}>{domain.status === 'online' ? '在线' : domain.status}</StatusBadge><span className="domain-latency">{domain.status === 'online' ? '公开入口可用' : '等待服务器恢复'}</span><button className="row-action" onClick={() => void copyDomain(domain.hostname)}><Copy size={16} /></button></div>)}</div>}</div><div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>分配新的公开域名</h3><p>域名前缀需要唯一、长度不超过 48 个字符，并避开平台保留字。</p><button className="button primary" onClick={onAssign}><Plus size={15} />分配公开域名</button></div></div>
}

function Usage({ settings, usage, localUsage, loading, error, onNavigate }: { settings: PlatformSettings | null; usage: CloudflareUsage | null; localUsage: LocalUsage | null; loading: boolean; error: string | null; onNavigate: (page: Page) => void }) {
  const requestValue = typeof usage?.requests === 'number' ? usage.requests.toLocaleString('zh-CN') : '—'
  const localRequestValue = localUsage ? localUsage.requestCount.toLocaleString('zh-CN') : '—'
  const requestLimit = settings ? settings.quotas.requests.toLocaleString('zh-CN') : '未读取'
  const connectionLimit = settings ? settings.quotas.activeConnections.toLocaleString('zh-CN') : '未读取'
  const r2Limit = settings ? formatBytes(settings.quotas.r2Bytes) : '未读取'
  const connected = usage?.configured === true && typeof usage.requests === 'number'
  return <div className="stack">{error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>用量读取失败</strong><span>{error}</span></div><button onClick={() => onNavigate('settings')}>检查配置 <ArrowUpRight size={14} /></button></div>}{!error && <div className="notice-bar compact"><div className="notice-icon"><Cloud size={16} /></div><div><strong>{loading ? '正在读取官方数据' : connected ? 'Cloudflare Analytics 已连接' : '官方数据尚未连接'}</strong><span>{connected && usage.period ? `Worker 请求统计周期：${new Date(usage.period.start).toLocaleString('zh-CN')} 至 ${new Date(usage.period.end).toLocaleString('zh-CN')}` : '配置 Cloudflare OAuth 后，Analytics 数据会按 5 分钟至 1 小时缓存。'}</span></div><button onClick={() => onNavigate('settings')}>去配置 <ArrowUpRight size={14} /></button></div>}<div className="usage-grid"><ResourceCard title="Worker 请求" current={requestValue} limit={requestLimit} unit={connected ? '官方周期' : ''} percent={connected && settings ? Math.min(100, (usage.requests! / settings.quotas.requests) * 100) : 0} icon={Cloud} /><ResourceCard title="平台请求计数" current={localRequestValue} limit={requestLimit} unit={localUsage ? '24 小时窗口' : '未接入'} percent={localUsage && settings ? Math.min(100, (localUsage.requestCount / settings.quotas.requests) * 100) : 0} icon={Activity} /><ResourceCard title="R2 存储" current={localUsage ? formatBytes(localUsage.r2Bytes) : '—'} limit={r2Limit} unit={localUsage ? `${localUsage.r2Objects} 个对象` : settings ? '平台阈值' : ''} percent={localUsage && settings ? Math.min(100, (localUsage.r2Bytes / settings.quotas.r2Bytes) * 100) : 0} icon={HardDrive} /><ResourceCard title="活跃连接" current={localUsage ? localUsage.activeConnections.toLocaleString('zh-CN') : '—'} limit={connectionLimit} unit={localUsage ? 'WebSocket / SSE' : '未接入'} percent={localUsage && settings ? Math.min(100, (localUsage.activeConnections / settings.quotas.activeConnections) * 100) : 0} icon={Activity} /></div><div className="panel"><div className="panel-header"><div><h2>数据源状态</h2><p>平台本地计数与 Cloudflare 官方数据的更新时间。</p></div></div><div className="source-row"><span className="source-name"><span className={`source-dot ${connected ? 'green' : 'pending'}`} />Cloudflare Analytics API</span><span className="muted">{connected ? `${usage.cached ? '缓存' : '最新'} · ${usage.updatedAt ? new Date(usage.updatedAt).toLocaleString('zh-CN') : '时间未知'}` : '未配置'}</span><button className="text-link" onClick={() => onNavigate('settings')}>配置 <ArrowUpRight size={14} /></button></div><div className="source-row"><span className="source-name"><span className={`source-dot ${localUsage ? 'green' : 'pending'}`} />平台本地计数</span><span className="muted">{localUsage?.updatedAt ? `更新于 ${new Date(localUsage.updatedAt).toLocaleString('zh-CN')}` : '未接入'}</span><span className="muted">{localUsage?.requestWindowStartedAt ? `窗口始于 ${new Date(localUsage.requestWindowStartedAt).toLocaleString('zh-CN')}` : '暂无数据'}</span></div></div></div>
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '未读取'
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(value / 1024)} KB`
}

function ResourceCard({ title, current, limit, unit, percent = 0, icon: Icon }: { title: string; current: string; limit: string; unit: string; percent?: number; icon: typeof Cloud }) { return <div className="resource-card"><div className="resource-card-head"><div className="resource-card-icon"><Icon size={17} /></div><span>{title}</span></div><strong>{current}</strong><div className="resource-card-limit">上限 {limit} <span>{unit}</span></div><div className="progress"><span style={{ width: `${percent}%` }} /></div></div> }

function Audit({ audits, loading, error }: { audits: ApiAudit[]; loading: boolean; error: string | null }) { return <div className="stack">{error && <div className="notice-bar compact"><div className="notice-icon"><AlertCircle size={16} /></div><div><strong>审计日志读取失败</strong><span>{error}</span></div></div>}<div className="filter-row"><div className="filter-summary"><ListFilter size={15} />全部事件 <span className="divider" />最近 180 天</div><button className="button secondary small" disabled><FileText size={14} />导出日志</button></div>{loading ? <div className="empty-panel"><div className="empty-illustration"><RefreshCw size={20} /></div><h3>正在读取审计记录</h3><p>Worker 正在返回最近 180 天的事件。</p></div> : audits.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Activity size={20} /></div><h3>暂无审计记录</h3><p>平台产生审计事件后会显示在这里，导出功能尚未接入。</p></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>事件</th><th>详情</th><th>操作者</th><th>时间</th></tr></thead><tbody>{audits.map((item) => <tr key={item.id}><td><div className="cell-title"><div className="audit-icon"><Activity size={14} /></div><strong>{auditActionLabel(item.action)}</strong></div></td><td>{auditDetail(item)}</td><td><span className="operator"><div className="mini-avatar">—</div>当前用户</span></td><td className="muted">{new Date(item.created_at).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div></div>}</div> }

function SettingsPage({ settings, onSettingsChange, cloudflareSettings, onCloudflareChange, smtpSettings, onSmtpChange, invites, onInvitesChange, onAction }: { settings: PlatformSettings | null; onSettingsChange: (settings: PlatformSettings) => void; cloudflareSettings: CloudflareSettings | null; onCloudflareChange: (settings: CloudflareSettings) => void; smtpSettings: SmtpSettings | null; onSmtpChange: (settings: SmtpSettings) => void; invites: ApiInvite[] | null; onInvitesChange: (invites: ApiInvite[]) => void; onAction: (message: string) => void }) {
  const [saving, setSaving] = useState(false)
  const maintenance = settings?.maintenance ?? false
  const toggleMaintenance = async () => {
    if (!settings) {
      onAction('Worker API 未连接，不会修改平台配置')
      return
    }
    setSaving(true)
    try {
      onSettingsChange(await updatePlatformSettings({ ...settings, maintenance: !maintenance }))
      onAction(!maintenance ? '平台已进入维护模式' : '平台已恢复运行')
    } catch {
      onAction('维护状态更新失败')
    } finally {
      setSaving(false)
    }
  }
  const startCloudflareAuth = () => { window.location.assign(`${import.meta.env.VITE_API_BASE ?? ''}/auth/cloudflare/start`) }
  const revokeCloudflare = async () => {
    if (!cloudflareSettings?.configured || !window.confirm('撤销 Cloudflare 授权并删除平台凭据？')) return
    try {
      onCloudflareChange(await revokeCloudflareSettings())
      onAction('Cloudflare 授权已撤销')
    } catch {
      onAction('Cloudflare 授权撤销失败')
    }
  }
  return <div className="settings-layout"><div className="settings-nav"><button className="selected"><Cloud size={15} />Cloudflare</button><button><Users size={15} />用户与邀请</button><button><FileText size={15} />邮件 SMTP</button><button><ShieldCheck size={15} />维护与配额</button></div><div className="settings-content"><div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Cloud size={18} /></div><div><h2>Cloudflare 授权</h2><p>平台账号统一管理 Worker、D1、R2 和 Durable Object 资源。</p></div><StatusBadge tone={cloudflareSettings?.configured ? 'success' : 'neutral'}>{cloudflareSettings?.configured ? '已授权' : cloudflareSettings ? '未配置' : '读取中'}</StatusBadge></div><div className="form-grid"><label>账号标识<input value={cloudflareSettings?.accountId ?? ''} placeholder={cloudflareSettings?.configured ? '等待识别账号' : '尚未连接'} disabled /></label><label>授权状态<input value={cloudflareSettings?.configured ? (cloudflareSettings.accountIdConfigured ? 'OAuth 已完成' : 'OAuth 已完成，缺少唯一账号') : ''} placeholder={cloudflareSettings ? '等待管理员授权' : '读取中'} disabled /></label></div><div className="settings-actions"><button className="button primary" onClick={startCloudflareAuth} disabled={!cloudflareSettings}>{cloudflareSettings?.configured ? '重新授权' : '开始授权'} <ArrowUpRight size={14} /></button>{cloudflareSettings?.configured && <button className="button secondary" onClick={revokeCloudflare}>撤销授权</button>}<span className="form-hint"><LockKeyhole size={13} />令牌仅由后台服务使用，并加密保存。</span></div></div><InvitePanel invites={invites} onChange={onInvitesChange} onAction={onAction} /><SmtpPanel settings={smtpSettings} onChange={onSmtpChange} onAction={onAction} /><div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><ShieldCheck size={18} /></div><div><h2>全局维护状态</h2><p>{settings ? '读取自 Worker 平台配置。' : 'Worker API 未连接，不会修改真实平台状态。'}</p></div><StatusBadge tone={maintenance ? 'warning' : settings ? 'success' : 'neutral'}>{maintenance ? '维护中' : settings ? '运行中' : '未读取'}</StatusBadge></div><div className="maintenance-row"><div><strong>{maintenance ? '暂停新连接' : '允许新连接'}</strong><span>{maintenance ? '公开入口和新增配置请求会被暂时拒绝。' : '插件服务器和公开域名当前可以正常连接。'}</span></div><button className={`toggle ${maintenance ? '' : 'on'}`} disabled={saving || !settings} onClick={toggleMaintenance}><span /></button></div></div></div></div>
}

function InvitePanel({ invites, onChange, onAction }: { invites: ApiInvite[] | null; onChange: (invites: ApiInvite[]) => void; onAction: (message: string) => void }) {
  const [email, setEmail] = useState('')
  const [githubLogin, setGithubLogin] = useState('')
  const [expiresInHours, setExpiresInHours] = useState('72')
  const [saving, setSaving] = useState(false)
  const [latestUrl, setLatestUrl] = useState<string | null>(null)

  const refresh = async () => onChange(await fetchInvites())
  const create = async () => {
    setSaving(true)
    try {
      const result = await createInvite({ email: email.trim() || undefined, githubLogin: githubLogin.trim() || undefined, expiresInHours: Number(expiresInHours) || 72 })
      setLatestUrl(result.inviteUrl)
      setEmail('')
      setGithubLogin('')
      await refresh()
      onAction(result.emailSent === false && email.trim() ? '邀请已创建，但邮件发送失败，请复制链接' : '邀请已创建')
    } catch (error) {
      onAction(error instanceof Error ? error.message : '邀请创建失败')
    } finally {
      setSaving(false)
    }
  }
  const revoke = async (invite: ApiInvite) => {
    if (!window.confirm('撤销这个仍未使用的邀请？')) return
    try {
      await revokeInvite(invite.id)
      await refresh()
      onAction('邀请已撤销')
    } catch (error) {
      onAction(error instanceof Error ? error.message : '邀请撤销失败')
    }
  }
  const copy = async () => {
    if (!latestUrl) return
    await navigator.clipboard.writeText(latestUrl)
    onAction('邀请链接已复制')
  }
  return <div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Users size={18} /></div><div><h2>用户与邀请</h2><p>{invites ? '创建一次性 GitHub 邀请，并管理尚未使用的链接。' : '超级管理员邀请数据尚未读取。'}</p></div><StatusBadge tone={invites ? 'success' : 'neutral'}>{invites ? `${invites.length} 条记录` : '未读取'}</StatusBadge></div><div className="form-grid"><label>邮箱（可选）<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={!invites || saving} /></label><label>GitHub 用户名（可选）<input value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="github-login" disabled={!invites || saving} /></label><label>有效期（小时）<input type="number" min="1" max="720" value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} disabled={!invites || saving} /></label></div><div className="settings-actions"><button className="button primary" onClick={() => void create()} disabled={!invites || saving}>创建邀请<Plus size={14} /></button>{latestUrl && <><input className="invite-url" value={latestUrl} readOnly aria-label="新创建的邀请链接" /><button className="button secondary" onClick={() => void copy()}><Copy size={14} />复制链接</button></>}</div>{invites === null ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>邀请数据未接入</h3><p>仅超级管理员可读取邀请列表。</p></div> : invites.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>暂无邀请</h3><p>创建邀请后，链接和状态会显示在这里。</p></div> : <div className="table-wrap"><table><thead><tr><th>身份</th><th>状态</th><th>有效期</th><th /></tr></thead><tbody>{invites.map((invite) => <tr key={invite.id}><td><div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{invite.github_login || invite.email || '未指定身份'}</strong><small>{invite.email || '未填写邮箱'}</small></div></div></td><td><StatusBadge tone={invite.status === 'pending' ? 'warning' : invite.status === 'used' ? 'success' : 'neutral'}>{invite.status}</StatusBadge></td><td>{new Date(invite.expires_at).toLocaleString('zh-CN')}</td><td>{invite.status === 'pending' && <button className="row-action" onClick={() => void revoke(invite)} aria-label="撤销邀请" title="撤销邀请"><X size={15} /></button>}</td></tr>)}</tbody></table></div>}</div>
}

function SmtpPanel({ settings, onChange, onAction }: { settings: SmtpSettings | null; onChange: (settings: SmtpSettings) => void; onAction: (message: string) => void }) {
  const [form, setForm] = useState({ host: '', port: '587', secure: false, username: '', password: '', authType: 'plain' as 'plain' | 'login' | 'cram-md5', from: '', fromName: '', replyTo: '', testTo: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    if (!settings?.configured) return
    setForm((current) => ({ ...current, host: settings.host ?? '', port: String(settings.port ?? 587), secure: settings.secure ?? false, username: settings.username ?? '', authType: settings.authType ?? 'plain', from: settings.from ?? '', fromName: settings.fromName ?? '', replyTo: settings.replyTo ?? '' }))
  }, [settings])
  const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (!settings) return onAction('Worker API 未连接，不会保存 SMTP 配置')
    setSaving(true)
    try {
      onChange(await updateSmtpSettings({ host: form.host, port: Number(form.port), secure: form.secure, username: form.username, password: form.password, authType: form.authType, from: form.from, fromName: form.fromName, replyTo: form.replyTo }))
      update('password', '')
      onAction('SMTP 配置已保存')
    } catch { onAction('SMTP 配置保存失败') } finally { setSaving(false) }
  }
  const test = async () => {
    if (!settings) return onAction('Worker API 未连接，不会发送测试邮件')
    setTesting(true)
    try { await sendSmtpTest(form.testTo); onAction('测试邮件已发送') } catch { onAction('测试邮件发送失败') } finally { setTesting(false) }
  }
  return <div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Mail size={18} /></div><div><h2>邮件 SMTP</h2><p>{settings ? '配置后可发送邀请和维护通知。密码只保存密文，不会回显。' : 'Worker API 未连接，不会连接 SMTP 服务。'}</p></div><StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? '已配置' : settings ? '未配置' : '未读取'}</StatusBadge></div><div className="form-grid"><label>SMTP Host<input value={form.host} onChange={(event) => update('host', event.target.value)} placeholder="smtp.example.com" disabled={!settings} /></label><label>端口<input type="number" min="1" max="65535" value={form.port} onChange={(event) => update('port', event.target.value)} disabled={!settings} /></label><label>用户名<input value={form.username} onChange={(event) => update('username', event.target.value)} disabled={!settings} /></label><label>密码 / 授权码<input type="password" value={form.password} onChange={(event) => update('password', event.target.value)} placeholder={settings?.configured ? '重新保存时填写' : 'SMTP 授权码'} disabled={!settings} /></label><label>认证方式<select value={form.authType} onChange={(event) => update('authType', event.target.value)} disabled={!settings}><option value="plain">PLAIN</option><option value="login">LOGIN</option><option value="cram-md5">CRAM-MD5</option></select></label><label>发件邮箱<input type="email" value={form.from} onChange={(event) => update('from', event.target.value)} placeholder="noreply@example.com" disabled={!settings} /></label><label>发件人名称<input value={form.fromName} onChange={(event) => update('fromName', event.target.value)} disabled={!settings} /></label><label>回复邮箱<input type="email" value={form.replyTo} onChange={(event) => update('replyTo', event.target.value)} disabled={!settings} /></label></div><div className="smtp-options"><label className="check-row"><input type="checkbox" checked={form.secure} onChange={(event) => update('secure', event.target.checked)} disabled={!settings} />使用 SMTPS / SSL</label><span className="form-hint">Workers 不能使用 25 端口，通常使用 465 或 587。</span></div><div className="settings-actions"><button className="button primary" onClick={save} disabled={saving || !settings}>{saving ? '保存中...' : '保存 SMTP 配置'}<Check size={14} /></button><div className="smtp-test"><input value={form.testTo} onChange={(event) => update('testTo', event.target.value)} placeholder="测试收件邮箱" disabled={!settings} /><button className="button secondary" onClick={test} disabled={testing || !settings}>{testing ? '发送中...' : '发送测试邮件'}<ArrowUpRight size={14} /></button></div></div></div>
}

function Modal({ type, plugins, onClose, onConfirm }: { type: 'server' | 'domain' | 'plugin'; plugins: ApiPlugin[]; onClose: () => void; onConfirm: (input: ModalInput) => Promise<ModalResult> }) {
  const [value, setValue] = useState('')
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ModalResult | null>(null)
  const loadablePlugins = plugins.filter((plugin) => !['loaded', 'enabled'].includes(plugin.state))
  const domainPlugins = plugins.filter((plugin) => plugin.state === 'enabled' && !plugin.domain_hostname)
  const candidates = type === 'plugin' ? loadablePlugins : domainPlugins
  const content = type === 'server'
    ? { title: '绑定插件服务器', description: '生成一次性注册码，在服务器本地 Web UI 中完成绑定。' }
    : type === 'domain'
      ? { title: '分配公开域名', description: '域名会绑定到一个已通过健康检查的插件实例。' }
      : { title: '加载插件', description: '从已连接的服务器选择一个已发现的 manifest。' }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      setResult(await onConfirm({ prefix: type === 'domain' ? value : undefined, pluginInstanceId: type === 'server' ? undefined : selectedPluginId }))
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const copyCode = async (code: string) => {
    if (!navigator.clipboard) {
      setError('当前浏览器不支持复制，请手动复制注册码')
      return
    }
    try {
      await navigator.clipboard.writeText(code)
      setError(null)
    } catch {
      setError('注册码复制失败，请手动复制')
    }
  }

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}><div className="modal"><div className="modal-head"><div><h2>{content.title}</h2><p>{content.description}</p></div><IconButton label="关闭弹窗" onClick={onClose}><X size={17} /></IconButton></div>{result?.kind === 'registration' && <div className="code-callout"><span>注册码有效至 {new Date(result.expiresAt).toLocaleString('zh-CN')}</span><div className="code-value"><strong>{result.code}</strong><button className="row-action" onClick={() => void copyCode(result.code)} aria-label="复制注册码" title="复制注册码"><Copy size={15} /></button></div></div>}{result?.kind === 'plugin' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>加载命令已确认</h3><p>插件当前状态：{result.state}</p></div>}{result?.kind === 'domain' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>公开域名已分配</h3><p>{result.hostname}</p></div>}{!result && type === 'server' && <div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>生成一次性注册码</h3><p>注册码仅显示在当前窗口，有效期 10 分钟且只能使用一次。</p></div>}{!result && type !== 'server' && <>{candidates.length > 0 ? <label className="modal-field">插件实例<select autoFocus value={selectedPluginId} onChange={(event) => setSelectedPluginId(event.target.value)}><option value="">请选择插件实例</option>{candidates.map((plugin) => <option value={plugin.id} key={plugin.id}>{plugin.name} · {plugin.plugin_id} · {plugin.server_name}</option>)}</select></label> : <div className="empty-panel"><div className="empty-illustration"><AlertCircle size={22} /></div><h3>{type === 'plugin' ? '暂无可加载插件' : '暂无可分配插件'}</h3><p>{type === 'plugin' ? '需要先由服务器同步尚未加载的 manifest。' : '需要已启用、通过健康检查且尚未分配域名的插件。'}</p></div>}{type === 'domain' && candidates.length > 0 && <label className="modal-field">域名前缀<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如：my-plugin" maxLength={48} /><span className="field-hint">仅允许小写字母、数字和连字符，长度不超过 48 个字符。</span></label>}</>}{error && <div className="auth-error"><AlertCircle size={14} />{error}</div>}<div className="modal-actions"><button className="button secondary" onClick={onClose} disabled={submitting}>关闭</button>{!result && <button className="button primary" onClick={() => void submit()} disabled={submitting || (type !== 'server' && (!selectedPluginId || candidates.length === 0))}>{submitting ? '提交中...' : type === 'server' ? '生成注册码' : type === 'domain' ? '分配域名' : '加载插件'}<ArrowUpRight size={14} /></button>}</div></div></div>
}

export default App
