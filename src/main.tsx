import { useMemo, useState } from 'react'
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
  TerminalSquare,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import './styles.css'

type Page = 'overview' | 'servers' | 'plugins' | 'domains' | 'usage' | 'audit' | 'settings'
type Theme = 'dark' | 'light' | 'system'

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

const demoServers = [
  { name: '本地开发服务器', host: 'localhost', status: '在线', detail: '刚刚同步', icon: TerminalSquare },
  { name: '等待绑定的服务器', host: '尚未配置', status: '待连接', detail: '使用一次性注册码开始', icon: Server },
]

const demoPlugins = [
  { name: '示例插件', id: 'example.plugin', version: '0.1.0', server: '本地开发服务器', state: '已启用', domain: 'example.plugins.example.com', kind: 'HTTP + SSE' },
  { name: '未加载插件', id: '等待服务器同步 manifest', version: '—', server: '等待绑定的服务器', state: '待发现', domain: '—', kind: '—' },
]

const auditItems = [
  { action: '平台初始化', detail: '创建演示工作区', time: '今天', tone: 'success' },
  { action: '等待 GitHub OAuth', detail: '管理员授权后可启用真实数据', time: '待配置', tone: 'muted' },
  { action: '等待第一台服务器', detail: '服务器连接后会在此记录注册事件', time: '待配置', tone: 'muted' },
]

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function StatusBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  return <span className={`status-badge ${tone}`}><span className="status-dot" />{children}</span>
}

function App() {
  const [page, setPage] = useState<Page>('overview')
  const [theme, setTheme] = useState<Theme>('dark')
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modal, setModal] = useState<'server' | 'domain' | 'plugin' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d')

  const meta = pageMeta[page]
  const themeLabel = theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '系统'

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const filteredPlugins = useMemo(() => {
    if (!search.trim()) return demoPlugins
    const q = search.toLowerCase()
    return demoPlugins.filter((plugin) => `${plugin.name} ${plugin.id} ${plugin.domain}`.toLowerCase().includes(q))
  }, [search])

  const selectPage = (next: Page) => {
    setPage(next)
    setSidebarOpen(false)
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Network size={17} strokeWidth={2.4} /></div>
          <div><div className="brand-name">Plugmesh</div><div className="brand-caption">插件平台</div></div>
          <IconButton label="关闭导航" onClick={() => setSidebarOpen(false)}><X size={17} /></IconButton>
        </div>
        <div className="workspace-switcher"><div className="workspace-icon">P</div><div className="workspace-copy"><strong>预览工作区</strong><span>演示环境</span></div><ChevronDown size={14} /></div>
        <nav className="nav-area">
          {navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(({ id, label, icon: NavIcon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => selectPage(id)}><NavIcon size={16} /><span>{label}</span>{id === 'servers' && <span className="nav-count">1</span>}</button>)}</div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-link"><CircleHelp size={15} /><span>帮助与协议</span><ExternalLink size={12} /></div>
          <div className="user-card"><div className="avatar">AD</div><div className="user-copy"><strong>管理员</strong><span>admin@example.com</span></div><MoreHorizontal size={16} /></div>
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
            <div className="page-header"><div><div className="eyebrow"><span className="live-pulse" />平台运行中</div><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="header-actions">{page === 'overview' && <button className="button secondary" onClick={() => showToast('已刷新平台状态')}><RefreshCw size={15} />刷新状态</button>}{page === 'servers' && <button className="button primary" onClick={() => setModal('server')}><Plus size={16} />绑定服务器</button>}{page === 'domains' && <button className="button primary" onClick={() => setModal('domain')}><Plus size={16} />分配域名</button>}{page === 'plugins' && <button className="button primary" onClick={() => setModal('plugin')}><Plus size={16} />加载插件</button>}</div></div>
            {page === 'overview' && <Overview range={range} setRange={setRange} onAction={showToast} onNavigate={selectPage} />}
            {page === 'servers' && <Servers onAction={showToast} onBind={() => setModal('server')} />}
            {page === 'plugins' && <Plugins plugins={filteredPlugins} onAction={showToast} onLoad={() => setModal('plugin')} />}
            {page === 'domains' && <Domains onAction={showToast} onAssign={() => setModal('domain')} />}
            {page === 'usage' && <Usage onAction={showToast} />}
            {page === 'audit' && <Audit />}
            {page === 'settings' && <SettingsPage onAction={showToast} />}
          </div>
        </div>
      </main>
      {modal && <Modal type={modal} onClose={() => setModal(null)} onConfirm={(message) => { setModal(null); showToast(message) }} />}
      {toast && <div className="toast"><div className="toast-icon"><Check size={14} /></div>{toast}</div>}
    </div>
  )
}

function Overview({ range, setRange, onAction, onNavigate }: { range: '24h' | '7d' | '30d'; setRange: (value: '24h' | '7d' | '30d') => void; onAction: (message: string) => void; onNavigate: (page: Page) => void }) {
  return <>
    <div className="notice-bar"><div className="notice-icon"><ShieldCheck size={16} /></div><div><strong>演示工作区已就绪</strong><span>连接 GitHub OAuth 和第一台插件服务器后，平台会开始写入实时数据。</span></div><button onClick={() => onNavigate('settings')}>配置平台 <ArrowUpRight size={14} /></button></div>
    <section className="metric-grid">
      <Metric label="在线服务器" value="1" suffix="/ 1" note="连接正常" icon={Server} tone="green" onClick={() => onNavigate('servers')} />
      <Metric label="已启用插件" value="1" suffix="" note="通过健康检查" icon={Box} tone="blue" onClick={() => onNavigate('plugins')} />
      <Metric label="公开域名" value="1" suffix="" note="1 个演示入口" icon={Globe2} tone="purple" onClick={() => onNavigate('domains')} />
      <Metric label="当前连接" value="0" suffix="" note="暂无 SSE / WebSocket" icon={Zap} tone="amber" onClick={() => onNavigate('usage')} />
    </section>
    <section className="content-grid two-thirds">
      <div className="panel chart-panel"><div className="panel-header"><div><h2>请求趋势</h2><p>平台本地计数，接入真实流量后更新</p></div><div className="segmented">{(['24h', '7d', '30d'] as const).map((item) => <button className={range === item ? 'selected' : ''} key={item} onClick={() => setRange(item)}>{item}</button>)}</div></div><div className="empty-chart"><div className="chart-grid-lines"><span /><span /><span /><span /></div><div className="chart-bars">{[20, 34, 25, 44, 30, 52, 36, 61, 46, 72, 54, 38, 26, 19].map((height, index) => <div className="bar-wrap" key={index}><div className={`chart-bar ${index === 9 ? 'accent' : ''}`} style={{ height: `${height}%` }} /></div>)}</div><div className="chart-axis"><span>起始</span><span>中段</span><span>现在</span></div><div className="chart-footnote"><span><i className="legend-dot" />暂无真实请求数据</span><span>范围：{range === '24h' ? '过去 24 小时' : range === '7d' ? '过去 7 天' : '过去 30 天'}</span></div></div></div>
      <div className="panel"><div className="panel-header"><div><h2>资源使用</h2><p>全局阈值控制</p></div><IconButton label="查看用量详情" onClick={() => onNavigate('usage')}><ArrowUpRight size={15} /></IconButton></div><div className="resource-list"><Resource label="Worker 请求" value="0" limit="100,000 / 月" percent={0} icon={Cloud} /><Resource label="R2 中转容量" value="0 B" limit="10 GB" percent={0} icon={HardDrive} /><Resource label="D1 数据库" value="0" limit="100,000 次" percent={0} icon={Database} /><Resource label="Durable Object" value="0" limit="100 并发" percent={0} icon={Activity} /></div><button className="text-link" onClick={() => onNavigate('usage')}>查看全部配额 <ArrowUpRight size={14} /></button></div>
    </section>
    <section className="content-grid two-thirds bottom-grid"><div className="panel"><div className="panel-header"><div><h2>最近活动</h2><p>最新平台事件与配置变化</p></div><button className="text-link" onClick={() => onNavigate('audit')}>查看审计日志 <ArrowUpRight size={14} /></button></div><div className="activity-list">{auditItems.map((item) => <div className="activity-item" key={item.action}><div className={`activity-mark ${item.tone}`}><Check size={13} /></div><div className="activity-copy"><strong>{item.action}</strong><span>{item.detail}</span></div><time>{item.time}</time></div>)}</div></div><div className="panel quick-panel"><div className="panel-header"><div><h2>快速开始</h2><p>完成平台接入需要三步</p></div></div><QuickStep number="01" title="绑定插件服务器" detail="安装本地服务器并输入注册码" done onClick={() => onNavigate('servers')} /><QuickStep number="02" title="加载第一个插件" detail="同步 manifest 并完成健康检查" done onClick={() => onNavigate('plugins')} /><QuickStep number="03" title="分配公开域名" detail="为插件选择唯一的子域名前缀" done onClick={() => onNavigate('domains')} /></div></section>
  </>
}

function Metric({ label, value, suffix, note, icon: Icon, tone, onClick }: { label: string; value: string; suffix: string; note: string; icon: typeof Server; tone: string; onClick: () => void }) { return <button className="metric-card" onClick={onClick}><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div className="metric-label">{label}<ArrowUpRight size={13} /></div><div className="metric-number">{value}<small>{suffix}</small></div><div className="metric-note"><span className="status-dot green" />{note}</div></button> }
function Resource({ label, value, limit, percent, icon: Icon }: { label: string; value: string; limit: string; percent: number; icon: typeof Cloud }) { return <div className="resource"><div className="resource-top"><div className="resource-label"><Icon size={15} />{label}</div><strong>{value}</strong></div><div className="progress"><span style={{ width: `${percent}%` }} /></div><div className="resource-bottom"><span>当前用量</span><span>{limit}</span></div></div> }
function QuickStep({ number, title, detail, done, onClick }: { number: string; title: string; detail: string; done?: boolean; onClick: () => void }) { return <button className="quick-step" onClick={onClick}><span className={`step-number ${done ? 'done' : ''}`}>{done ? <Check size={13} /> : number}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></button> }

function Servers({ onAction, onBind }: { onAction: (message: string) => void; onBind: () => void }) { return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>已绑定服务器</h2><p>每台服务器通过一条出站 WebSocket 连接平台。</p></div><button className="button secondary small" onClick={() => onAction('正在刷新服务器状态')}><RefreshCw size={14} />刷新</button></div><div className="server-list">{demoServers.map((server, index) => <div className="server-row" key={server.name}><div className="server-symbol"><server.icon size={18} /></div><div className="server-main"><strong>{server.name}</strong><span>{server.host} · {index === 0 ? '协议 v1' : '尚未注册'}</span></div><StatusBadge tone={index === 0 ? 'success' : 'neutral'}>{server.status}</StatusBadge><div className="server-meta"><span>{server.detail}</span><button className="row-action" onClick={() => onAction(index === 0 ? '已发送健康检查' : '请先完成服务器绑定')}><MoreHorizontal size={17} /></button></div></div>)}</div></div><div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>需要绑定更多服务器？</h3><p>从管理端生成一次性注册码，在服务器本地 Web UI 中完成绑定。</p><button className="button primary" onClick={onBind}><Plus size={15} />生成注册码</button></div></div> }

function Plugins({ plugins, onAction, onLoad }: { plugins: typeof demoPlugins; onAction: (message: string) => void; onLoad: () => void }) { return <div className="stack"><div className="filter-row"><div className="filter-summary"><span className="filter-dot" />已加载 1 个插件 <span className="divider" />等待发现 1 个</div><button className="button secondary small" onClick={() => onAction('正在请求服务器同步 manifest')}><RefreshCw size={14} />同步 manifest</button></div><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>插件</th><th>服务器</th><th>状态</th><th>能力</th><th>公开入口</th><th /></tr></thead><tbody>{plugins.map((plugin) => <tr key={plugin.id}><td><div className="cell-title"><div className="table-icon"><Code2 size={15} /></div><div><strong>{plugin.name}</strong><small>{plugin.id} · v{plugin.version}</small></div></div></td><td>{plugin.server}</td><td><StatusBadge tone={plugin.state === '已启用' ? 'success' : 'neutral'}>{plugin.state}</StatusBadge></td><td><span className="capability">{plugin.kind}</span></td><td>{plugin.domain === '—' ? <span className="muted">未分配</span> : <a href="#domain" onClick={(e) => e.preventDefault()}>{plugin.domain}</a>}</td><td><button className="row-action" onClick={() => onAction(plugin.state === '已启用' ? '已发送重载命令' : '插件尚未加载')}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>显示 {plugins.length} 个插件</span><button className="text-link" onClick={onLoad}>加载插件 <Plus size={14} /></button></div></div></div> }

function Domains({ onAction, onAssign }: { onAction: (message: string) => void; onAssign: () => void }) { return <div className="stack"><div className="panel table-panel"><div className="panel-header"><div><h2>公开入口</h2><p>插件域名由平台通配路由统一处理，无需逐个创建 DNS 记录。</p></div><button className="button secondary small" onClick={() => onAction('已复制平台域名格式')}><Copy size={14} />复制格式</button></div><div className="domain-list"><div className="domain-row"><div className="domain-icon"><Globe2 size={17} /></div><div className="domain-main"><strong>example.plugins.example.com</strong><span>示例插件 · 本地开发服务器</span></div><StatusBadge tone="success">在线</StatusBadge><span className="domain-latency">健康检查通过</span><button className="row-action" onClick={() => onAction('已复制公开域名')}><Copy size={16} /></button></div></div></div><div className="empty-panel"><div className="empty-illustration"><Globe2 size={22} /></div><h3>为下一个插件分配域名</h3><p>域名前缀需要唯一、长度不超过 48 个字符，并避开平台保留字。</p><button className="button primary" onClick={onAssign}><Plus size={15} />分配公开域名</button></div></div> }

function Usage({ onAction }: { onAction: (message: string) => void }) { return <div className="stack"><div className="notice-bar compact"><div className="notice-icon"><Cloud size={16} /></div><div><strong>官方数据尚未连接</strong><span>配置 Cloudflare OAuth 后，Analytics 数据会按 5 分钟至 1 小时缓存。</span></div><button onClick={() => onAction('请先在系统设置中配置 Cloudflare OAuth')}>去配置 <ArrowUpRight size={14} /></button></div><div className="usage-grid"><ResourceCard title="Worker 请求" current="0" limit="100,000" unit="次 / 月" icon={Cloud} /><ResourceCard title="R2 存储" current="0 B" limit="10 GB" unit="容量" icon={HardDrive} /><ResourceCard title="D1 操作" current="0" limit="100,000" unit="次 / 月" icon={Database} /><ResourceCard title="连接上限" current="0" limit="100" unit="并发连接" icon={Activity} /></div><div className="panel"><div className="panel-header"><div><h2>数据源状态</h2><p>平台本地计数与 Cloudflare 官方数据的更新时间。</p></div></div><div className="source-row"><span className="source-name"><span className="source-dot pending" />Cloudflare Analytics API</span><span className="muted">未配置</span><button className="text-link" onClick={() => onAction('打开系统设置')}>配置 <ArrowUpRight size={14} /></button></div><div className="source-row"><span className="source-name"><span className="source-dot green" />平台本地计数</span><span className="muted">实时</span><span className="muted">演示数据</span></div></div></div> }
function ResourceCard({ title, current, limit, unit, icon: Icon }: { title: string; current: string; limit: string; unit: string; icon: typeof Cloud }) { return <div className="resource-card"><div className="resource-card-head"><div className="resource-card-icon"><Icon size={17} /></div><span>{title}</span></div><strong>{current}</strong><div className="resource-card-limit">上限 {limit} <span>{unit}</span></div><div className="progress"><span style={{ width: 0 }} /></div></div> }

function Audit() { return <div className="stack"><div className="filter-row"><div className="filter-summary"><ListFilter size={15} />全部事件 <span className="divider" />最近 180 天</div><button className="button secondary small"><FileText size={14} />导出日志</button></div><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>事件</th><th>详情</th><th>操作者</th><th>时间</th></tr></thead><tbody>{auditItems.map((item) => <tr key={item.action}><td><div className="cell-title"><div className={`audit-icon ${item.tone}`}><Activity size={14} /></div><strong>{item.action}</strong></div></td><td>{item.detail}</td><td><span className="operator"><div className="mini-avatar">AD</div>管理员</span></td><td className="muted">{item.time}</td></tr>)}</tbody></table></div></div></div> }

function SettingsPage({ onAction }: { onAction: (message: string) => void }) { return <div className="settings-layout"><div className="settings-nav"><button className="selected"><Cloud size={15} />Cloudflare</button><button><Users size={15} />用户与邀请</button><button><FileText size={15} />邮件 SMTP</button><button><ShieldCheck size={15} />维护与配额</button></div><div className="settings-content"><div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Cloud size={18} /></div><div><h2>Cloudflare 授权</h2><p>平台账号统一管理 Worker、D1、R2 和 Durable Object 资源。</p></div><StatusBadge>未配置</StatusBadge></div><div className="form-grid"><label>账号标识<input placeholder="尚未连接" disabled /></label><label>授权状态<input placeholder="等待管理员授权" disabled /></label></div><div className="settings-actions"><button className="button primary" onClick={() => onAction('Cloudflare OAuth 配置即将开放')}>开始授权 <ArrowUpRight size={14} /></button><span className="form-hint"><LockKeyhole size={13} />凭据仅由后台服务使用，并加密保存。</span></div></div><div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><ShieldCheck size={18} /></div><div><h2>全局维护状态</h2><p>达到平台总配额后，新流量会统一返回维护页。</p></div><StatusBadge tone="success">运行中</StatusBadge></div><div className="maintenance-row"><div><strong>允许新连接</strong><span>插件服务器和公开域名当前可以正常连接。</span></div><button className="toggle on" onClick={() => onAction('维护开关需要后台权限')}><span /></button></div></div></div></div> }

function Modal({ type, onClose, onConfirm }: { type: 'server' | 'domain' | 'plugin'; onClose: () => void; onConfirm: (message: string) => void }) { const content = type === 'server' ? { title: '绑定插件服务器', description: '生成一次性注册码，在服务器本地 Web UI 中完成绑定。', button: '生成注册码', message: '注册码已生成，复制后在本地服务器中使用。', label: '服务器名称', placeholder: '例如：工作站插件服务器' } : type === 'domain' ? { title: '分配公开域名', description: '域名会绑定到一个已通过健康检查的插件实例。', button: '分配域名', message: '公开域名分配请求已创建。', label: '域名前缀', placeholder: '例如：my-plugin' } : { title: '加载插件', description: '从已连接的服务器选择一个已发现的 manifest。', button: '发送加载命令', message: '加载命令已发送，等待服务器确认。', label: '插件标识', placeholder: 'example.plugin' }; return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div className="modal"><div className="modal-head"><div><h2>{content.title}</h2><p>{content.description}</p></div><IconButton label="关闭弹窗" onClick={onClose}><X size={17} /></IconButton></div><label className="modal-field">{content.label}<input autoFocus placeholder={content.placeholder} /><span className="field-hint">这是演示表单，接入 Worker API 后会进行服务端校验。</span></label>{type === 'domain' && <label className="modal-field">插件实例<select><option>示例插件 · example.plugin</option></select></label>}{type === 'server' && <div className="code-callout"><span>注册码有效期 10 分钟</span><strong>将在确认后生成</strong></div>}<div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={() => onConfirm(content.message)}>{content.button}<ArrowUpRight size={14} /></button></div></div></div> }

export default App
