import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  CircleHelp,
  CircleSlash,
  Cpu,
  FileCode2,
  HardDrive,
  LoaderCircle,
  Moon,
  Network,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sun,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './styles.css'

type Theme = 'dark' | 'light' | 'system'
type PluginState = 'discovered' | 'loaded' | 'enabled' | 'disabled' | 'unloaded' | 'failed' | string

interface LocalStatus {
  ok: boolean
  service: string
  port: number
  connected: boolean
  serverId?: string
  workerUrl?: string
}

interface LocalPlugin {
  id: string
  name: string
  version: string
  abiVersion: string
  library: string
  healthPath: string
  permissions: string[]
  state: PluginState
  capabilities: { http: boolean; websocket: boolean; sse: boolean; fileStream: boolean }
}

interface Diagnostics extends LocalStatus {
  pluginCount: number
  loadedPluginCount: number
  enabledPluginCount: number
  failedPluginCount: number
}

interface ActionResult {
  ok: boolean
  pluginId: string
  action: string
  state: PluginState
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const data = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new Error(data?.error || `请求失败（${response.status}）`)
  return data as T
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function stateLabel(state: PluginState) {
  return ({ discovered: '已发现', loaded: '已加载', enabled: '已启用', disabled: '已停用', unloaded: '已卸载', failed: '失败' } as Record<string, string>)[state] ?? state
}

function stateTone(state: PluginState) {
  if (state === 'enabled') return 'positive'
  if (state === 'failed') return 'negative'
  if (state === 'loaded' || state === 'disabled') return 'warning'
  return 'muted'
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('plugmesh-local-theme')
    return saved === 'light' || saved === 'system' ? saved : 'dark'
  })
  const [systemLight, setSystemLight] = useState(() => matchMedia('(prefers-color-scheme: light)').matches)
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [plugins, setPlugins] = useState<LocalPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const effectiveTheme = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme
  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const [nextStatus, nextDiagnostics, nextPlugins] = await Promise.all([
        request<LocalStatus>('/api/status'),
        request<Diagnostics>('/api/diagnostics'),
        request<{ plugins: LocalPlugin[] }>('/api/plugins'),
      ])
      setStatus(nextStatus)
      setDiagnostics(nextDiagnostics)
      setPlugins(nextPlugins.plugins ?? [])
      setError(null)
      setLastUpdated(new Date())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地服务器暂时无法访问')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => localStorage.setItem('plugmesh-local-theme', theme), [theme])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)')
    const update = (event: MediaQueryListEvent) => setSystemLight(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 3200)
    return () => window.clearTimeout(timer)
  }, [message])

  const runAction = async (plugin: LocalPlugin, action: 'load' | 'unload' | 'enable' | 'disable' | 'reload') => {
    setBusyPlugin(plugin.id)
    try {
      const result = await request<ActionResult>(`/api/plugins/${encodeURIComponent(plugin.id)}/${action}`, { method: 'POST' })
      setMessage({ kind: 'success', text: `${plugin.name}：${stateLabel(result.state)}` })
      await refresh()
    } catch (cause) {
      setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : '插件操作失败' })
    } finally {
      setBusyPlugin(null)
    }
  }

  const runHealth = async (plugin: LocalPlugin) => {
    setBusyPlugin(plugin.id)
    try {
      const result = await request<{ ok: boolean; status: number; bodySize: number; error?: string }>(`/api/plugins/${encodeURIComponent(plugin.id)}/health`)
      if (!result.ok) throw new Error(result.error || '健康检查失败')
      setMessage({ kind: 'success', text: `${plugin.name}：健康检查通过（${result.status}）` })
    } catch (cause) {
      setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : '健康检查失败' })
    } finally {
      setBusyPlugin(null)
    }
  }

  const themeIcon = theme === 'light' ? <Sun size={15} /> : theme === 'system' ? <CircleHelp size={15} /> : <Moon size={15} />
  const enabledCount = diagnostics?.enabledPluginCount ?? plugins.filter((plugin) => plugin.state === 'enabled').length

  return (
    <div className={`local-app theme-${effectiveTheme}`}>
      <aside className="rail">
        <div className="brand"><span className="brand-mark"><Network size={17} /></span><div><strong>PLUGMESH</strong><span>LOCAL SERVER</span></div></div>
        <div className={`connection-rail ${status?.connected ? 'online' : 'offline'}`}>
          <div className="connection-line" />
          <div className="connection-node"><span /></div>
          <div className="connection-copy"><span>控制连接</span><strong>{status?.connected ? '在线' : '离线'}</strong></div>
          <div className="connection-detail">{status?.serverId ?? '尚未读取服务器标识'}</div>
        </div>
        <nav className="side-nav" aria-label="本地服务器导航">
          <a className="side-link active" href="#overview"><Activity size={15} />运行概览</a>
          <a className="side-link" href="#plugins"><FileCode2 size={15} />插件目录<span>{plugins.length}</span></a>
          <a className="side-link" href="#setup"><Settings2 size={15} />连接设置</a>
        </nav>
        <div className="rail-bottom"><div className="local-only"><HardDrive size={14} /><span>仅监听<br /><strong>127.0.0.1:{status?.port ?? '----'}</strong></span></div><a className="docs-link" href="#setup"><Terminal size={14} />CLI 配置入口</a></div>
      </aside>

      <main className="workspace">
        <header className="topbar"><div><span className="overline">本地控制台 / 状态视图</span><h1>插件服务器</h1></div><div className="top-actions"><button className="icon-button" title="刷新数据" aria-label="刷新数据" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button><button className="icon-button" title="切换主题" aria-label="切换主题" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>{themeIcon}</button></div></header>

        {message && <div className={`toast ${message.kind}`} role="status">{message.kind === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}{message.text}<button onClick={() => setMessage(null)} aria-label="关闭提示"><X size={14} /></button></div>}
        {error && <section className="error-strip"><AlertCircle size={17} /><div><strong>无法读取本地服务器</strong><span>{error}</span></div><button className="button secondary" onClick={() => void refresh(true)}>重试</button></section>}

        <div className="content">
          <section id="overview" className="hero-grid"><div><span className="section-index">01 / 运行概览</span><h2>{status?.connected ? '控制连接正常' : '等待控制连接'}</h2><p>{status?.connected ? '服务器已连接到 Worker，插件命令可以从管理端下发。' : '本地服务正在运行，但尚未建立 Worker 控制 WebSocket。'}</p></div><div className={`status-seal ${status?.connected ? 'online' : 'offline'}`}><span>{status?.connected ? 'ONLINE' : 'OFFLINE'}</span><div>{status?.connected ? <Wifi size={34} /> : <WifiOff size={34} />}</div><small>{lastUpdated ? `更新于 ${formatTime(lastUpdated)}` : '正在获取状态'}</small></div></section>

          <section className="metric-grid" aria-label="运行指标"><Metric label="已发现插件" value={diagnostics?.pluginCount ?? (loading ? '—' : plugins.length)} icon={<FileCode2 size={16} />} /><Metric label="已启用" value={enabledCount} icon={<Cpu size={16} />} accent /><Metric label="失败状态" value={diagnostics?.failedPluginCount ?? 0} icon={<CircleSlash size={16} />} danger={Boolean(diagnostics?.failedPluginCount)} /><Metric label="本地端口" value={status?.port ?? '—'} icon={<Network size={16} />} /></section>

          <section id="plugins" className="section-block"><div className="section-heading"><div><span className="section-index">02 / 插件目录</span><h2>已发现插件</h2></div><span className="section-meta">{plugins.length} 个条目</span></div>{loading && <LoadingState />}{!loading && !error && plugins.length === 0 && <EmptyState title="尚未发现插件" body="将包含 manifest.json 的插件目录配置到服务器后，插件会出现在这里。" />}{!loading && !error && plugins.length > 0 && <div className="plugin-list">{plugins.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} busy={busyPlugin === plugin.id} onAction={(action) => void runAction(plugin, action)} onHealth={() => void runHealth(plugin)} />)}</div>}</section>

          <section id="setup" className="section-block setup-section"><div className="section-heading"><div><span className="section-index">03 / 连接设置</span><h2>首次绑定</h2></div><span className="status-badge muted"><span className="status-dot" />CLI fallback</span></div><div className="setup-grid"><div className="setup-copy"><h3>通过注册码绑定服务器</h3><p>首次绑定和凭据密码输入目前使用 CLI 完成。成功保存加密凭据后，服务器重启会自动恢复连接。</p><div className="command-block"><span>$</span><code>plugmesh-server --register &lt;worker-url&gt; &lt;server-name&gt; &lt;credential-file&gt;</code></div><span className="text-link">配置说明见 native-server/README.md</span></div><div className="setup-state"><Terminal size={22} /><strong>本地配置 UI 尚未接入</strong><span>当前不会在浏览器中收集注册码或凭据口令。</span></div></div></section>
        </div>
        <footer className="footer"><span>Plugmesh Local Server</span><span>API: {status?.service ?? 'unavailable'} · localhost only</span></footer>
      </main>
    </div>
  )
}

function Metric({ label, value, icon, accent = false, danger = false }: { label: string; value: number | string; icon: React.ReactNode; accent?: boolean; danger?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''} ${danger ? 'danger' : ''}`}><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong></div>
}

function PluginRow({ plugin, busy, onAction, onHealth }: { plugin: LocalPlugin; busy: boolean; onAction: (action: 'load' | 'unload' | 'enable' | 'disable' | 'reload') => void; onHealth: () => void }) {
  const canEnable = plugin.state === 'loaded' || plugin.state === 'disabled'
  const canDisable = plugin.state === 'enabled'
  const canUnload = plugin.state !== 'discovered' && plugin.state !== 'unloaded'
  return <article className="plugin-row"><div className="plugin-main"><div className="plugin-icon"><FileCode2 size={18} /></div><div className="plugin-copy"><div className="plugin-title"><h3>{plugin.name}</h3><span className={`status-badge ${stateTone(plugin.state)}`}><span className="status-dot" />{stateLabel(plugin.state)}</span></div><span className="plugin-id">{plugin.id} · v{plugin.version} · ABI {plugin.abiVersion}</span><div className="capability-list">{plugin.capabilities.http && <span>HTTP</span>}{plugin.capabilities.websocket && <span>WebSocket</span>}{plugin.capabilities.sse && <span>SSE</span>}{plugin.capabilities.fileStream && <span>文件流</span>}</div></div></div><div className="plugin-actions">{busy ? <span className="action-loading"><LoaderCircle size={16} className="spin" />处理中</span> : <>{plugin.state === 'enabled' && <ActionButton label="检查" onClick={onHealth} />}{plugin.state === 'discovered' || plugin.state === 'unloaded' ? <ActionButton label="加载" onClick={() => onAction('load')} /> : <ActionButton label="重载" onClick={() => onAction('reload')} />}{canEnable && <ActionButton label="启用" onClick={() => onAction('enable')} primary />}{canDisable && <ActionButton label="停用" onClick={() => onAction('disable')} />}{canUnload && <ActionButton label="卸载" onClick={() => onAction('unload')} />}</>}</div></article>
}

function ActionButton({ label, onClick, primary = false }: { label: string; onClick: () => void; primary?: boolean }) {
  return <button className={`button compact ${primary ? 'primary' : 'secondary'}`} onClick={onClick}>{label}</button>
}

function LoadingState() { return <div className="loading-state"><LoaderCircle size={18} className="spin" /><span>正在读取插件目录</span></div> }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty-state"><FileCode2 size={22} /><strong>{title}</strong><span>{body}</span></div> }

export default App
