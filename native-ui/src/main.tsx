import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  AlertCircle,
  Check,
  CircleHelp,
  CircleSlash,
  Cpu,
  FileCode2,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Network,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './styles.css'

type Theme = 'dark' | 'light' | 'system'
type PluginState = 'discovered' | 'loaded' | 'enabled' | 'disabled' | 'unloaded' | 'failed' | string

interface LocalSession {
  ok: boolean
  authenticated: boolean
  configured: boolean
  passwordConfigured: boolean
  passwordSetupRequired: boolean
}

interface LocalStatus {
  ok: boolean
  service: string
  port: number
  configured: boolean
  connected: boolean
  systemCredentialsAvailable: boolean
  serverId?: string
  workerUrl?: string
  credentialFile?: string
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

interface LocalLog {
  timestamp: string
  level: number
  message: string
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const data = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new RequestError(data?.error || `请求失败（${response.status}）`, response.status)
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

const emptySetupForm = {
  workerUrl: '',
  serverName: '',
  registrationCode: '',
  localUiPassword: '',
  localUiPasswordConfirmation: '',
  credentialPassword: '',
  credentialFile: '',
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('plugmesh-local-theme')
    return saved === 'light' || saved === 'system' ? saved : 'dark'
  })
  const [systemLight, setSystemLight] = useState(() => matchMedia('(prefers-color-scheme: light)').matches)
  const [session, setSession] = useState<LocalSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [plugins, setPlugins] = useState<LocalPlugin[]>([])
  const [logs, setLogs] = useState<LocalLog[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [accessBusy, setAccessBusy] = useState(false)
  const [credentialBusy, setCredentialBusy] = useState<'rotate' | 'revoke' | null>(null)
  const [loginPassword, setLoginPassword] = useState('')
  const [setupForm, setSetupForm] = useState(emptySetupForm)
  const [migrationForm, setMigrationForm] = useState({ password: '', passwordConfirmation: '', credentialPassword: '' })
  const [credentialPassword, setCredentialPassword] = useState('')

  const effectiveTheme = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme
  const cycleTheme = () => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
  const themeIcon = theme === 'light' ? <Sun size={15} /> : theme === 'system' ? <CircleHelp size={15} /> : <Moon size={15} />

  const loadSession = useCallback(async () => {
    try {
      const nextSession = await request<LocalSession>('/api/session')
      setSession(nextSession)
      setSessionError(null)
      return nextSession
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : '本地服务器暂时无法访问')
      return null
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const [nextStatus, nextDiagnostics, nextPlugins] = await Promise.all([
        request<LocalStatus>('/api/status'),
        request<Diagnostics>('/api/diagnostics'),
        request<{ plugins: LocalPlugin[] }>('/api/plugins'),
      ])
      const nextLogs = await request<{ logs: LocalLog[] }>('/api/logs')
      setStatus(nextStatus)
      setDiagnostics(nextDiagnostics)
      setPlugins(nextPlugins.plugins ?? [])
      setLogs(nextLogs.logs ?? [])
      setError(null)
      setLastUpdated(new Date())
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) void loadSession()
      else setError(cause instanceof Error ? cause.message : '本地服务器暂时无法访问')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadSession])

  const waitForRestart = useCallback(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      try {
        const nextSession = await request<LocalSession>('/api/session')
        setSession(nextSession)
        setSessionError(null)
        return true
      } catch {}
    }
    setSessionError('本地服务器重启超时，请稍后刷新页面')
    return false
  }, [])

  useEffect(() => { void loadSession() }, [loadSession])
  useEffect(() => {
    if (!session || session.configured || session.authenticated) return
    void request<LocalStatus>('/api/status')
      .then((nextStatus) => {
        setStatus(nextStatus)
        setSetupForm((current) => ({ ...current, credentialFile: current.credentialFile || nextStatus.credentialFile || '' }))
        setSessionError(null)
      })
      .catch((cause) => setSessionError(cause instanceof Error ? cause.message : '无法读取首次绑定状态'))
  }, [session])
  useEffect(() => {
    if (!session?.authenticated) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [refresh, session?.authenticated])
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

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAccessBusy(true)
    try {
      await request('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: loginPassword }),
      })
      setLoginPassword('')
      await loadSession()
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : '登录失败')
    } finally {
      setAccessBusy(false)
    }
  }

  const submitMigration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (migrationForm.password.length < 8 || migrationForm.password !== migrationForm.passwordConfirmation) {
      setSessionError(migrationForm.password.length < 8 ? '本地 UI 口令至少需要 8 个字符' : '两次输入的本地 UI 口令不一致')
      return
    }
    setAccessBusy(true)
    try {
      await request('/api/session/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(migrationForm),
      })
      setMigrationForm({ password: '', passwordConfirmation: '', credentialPassword: '' })
      await loadSession()
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : '本地 UI 口令设置失败')
    } finally {
      setAccessBusy(false)
    }
  }

  const submitSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (setupForm.localUiPassword.length < 8 || setupForm.localUiPassword !== setupForm.localUiPasswordConfirmation) {
      setSessionError(setupForm.localUiPassword.length < 8 ? '本地 UI 口令至少需要 8 个字符' : '两次输入的本地 UI 口令不一致')
      return
    }
    setAccessBusy(true)
    try {
      await request('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(setupForm),
      })
      setSetupForm((current) => ({ ...current, registrationCode: '', localUiPassword: '', localUiPasswordConfirmation: '', credentialPassword: '' }))
      setMessage({ kind: 'success', text: '绑定成功，请使用本地 UI 口令登录' })
      await waitForRestart()
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : '服务器绑定失败')
    } finally {
      setAccessBusy(false)
    }
  }

  const logout = async () => {
    await request('/api/session', { method: 'DELETE' }).catch(() => null)
    setSession((current) => current ? { ...current, authenticated: false } : current)
    setStatus(null)
    setDiagnostics(null)
    setPlugins([])
    setLogs([])
    setError(null)
  }

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

  const runCredentialAction = async (action: 'rotate' | 'revoke') => {
    if (action === 'revoke' && !window.confirm('撤销后当前服务器会断开连接，并需要重新绑定。继续吗？')) return
    setCredentialBusy(action)
    try {
      await request(`/api/credentials/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialPassword }),
      })
      setCredentialPassword('')
      setMessage({ kind: 'success', text: action === 'rotate' ? '访问密钥已轮换' : '绑定已撤销，请重新绑定服务器' })
      if (action === 'revoke') await waitForRestart()
      else await refresh(true)
    } catch (cause) {
      setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : '凭据操作失败' })
    } finally {
      setCredentialBusy(null)
    }
  }

  if (sessionLoading || !session) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <div className="access-loading"><LoaderCircle size={22} className="spin" /><strong>正在连接本地服务器</strong></div>
    </AccessShell>
  }

  if (!session.configured) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <form className="access-form access-form-wide" onSubmit={(event) => void submitSetup(event)}>
        <AccessHeading icon={<Network size={20} />} title="绑定插件服务器" />
        <div className="access-fields two-columns">
          <Field label="Worker 地址"><input value={setupForm.workerUrl} onChange={(event) => setSetupForm((current) => ({ ...current, workerUrl: event.target.value }))} placeholder="https://console.example.com" required /></Field>
          <Field label="服务器名称"><input value={setupForm.serverName} onChange={(event) => setSetupForm((current) => ({ ...current, serverName: event.target.value }))} required /></Field>
          <Field label="一次性注册码"><input value={setupForm.registrationCode} onChange={(event) => setSetupForm((current) => ({ ...current, registrationCode: event.target.value }))} required /></Field>
          <Field label="凭据文件路径"><input value={setupForm.credentialFile} onChange={(event) => setSetupForm((current) => ({ ...current, credentialFile: event.target.value }))} required={!status?.systemCredentialsAvailable} placeholder={status?.systemCredentialsAvailable ? '留空则使用系统凭据存储' : undefined} /></Field>
          <Field label="本地 UI 口令"><input type="password" autoComplete="new-password" minLength={8} value={setupForm.localUiPassword} onChange={(event) => setSetupForm((current) => ({ ...current, localUiPassword: event.target.value }))} required /></Field>
          <Field label="确认本地 UI 口令"><input type="password" autoComplete="new-password" minLength={8} value={setupForm.localUiPasswordConfirmation} onChange={(event) => setSetupForm((current) => ({ ...current, localUiPasswordConfirmation: event.target.value }))} required /></Field>
          <Field label="凭据文件加密口令" wide><input type="password" autoComplete="new-password" value={setupForm.credentialPassword} onChange={(event) => setSetupForm((current) => ({ ...current, credentialPassword: event.target.value }))} required={!status?.systemCredentialsAvailable || Boolean(setupForm.credentialFile)} placeholder={status?.systemCredentialsAvailable && !setupForm.credentialFile ? '使用系统凭据存储时可留空' : undefined} /></Field>
        </div>
        <button className="button primary with-icon" type="submit" disabled={accessBusy || !status}>{accessBusy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}绑定服务器</button>
      </form>
    </AccessShell>
  }

  if (session.passwordSetupRequired) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <form className="access-form" onSubmit={(event) => void submitMigration(event)}>
        <AccessHeading icon={<ShieldCheck size={20} />} title="设置本地 UI 口令" />
        <p className="access-note">现有绑定需要补充本地 UI 会话口令后才能继续。</p>
        <div className="access-fields">
          <Field label="本地 UI 口令"><input type="password" autoComplete="new-password" minLength={8} value={migrationForm.password} onChange={(event) => setMigrationForm((current) => ({ ...current, password: event.target.value }))} required /></Field>
          <Field label="确认本地 UI 口令"><input type="password" autoComplete="new-password" minLength={8} value={migrationForm.passwordConfirmation} onChange={(event) => setMigrationForm((current) => ({ ...current, passwordConfirmation: event.target.value }))} required /></Field>
          <Field label="凭据文件加密口令"><input type="password" autoComplete="current-password" value={migrationForm.credentialPassword} onChange={(event) => setMigrationForm((current) => ({ ...current, credentialPassword: event.target.value }))} placeholder="使用系统凭据存储时可留空" /></Field>
        </div>
        <button className="button primary with-icon" type="submit" disabled={accessBusy}>{accessBusy ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}保存并登录</button>
      </form>
    </AccessShell>
  }

  if (!session.authenticated) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <form className="access-form" onSubmit={(event) => void submitLogin(event)}>
        <AccessHeading icon={<KeyRound size={20} />} title="登录本地控制台" />
        <div className="access-fields">
          <Field label="本地 UI 口令"><input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoFocus required /></Field>
        </div>
        <button className="button primary with-icon" type="submit" disabled={accessBusy}>{accessBusy ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />}登录</button>
      </form>
    </AccessShell>
  }

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
          <a className="side-link" href="#logs"><Terminal size={15} />运行日志<span>{logs.length}</span></a>
        </nav>
        <div className="rail-bottom"><div className="local-only"><HardDrive size={14} /><span>仅监听<br /><strong>127.0.0.1:{status?.port ?? '----'}</strong></span></div><a className="docs-link" href="#setup"><Terminal size={14} />CLI 配置入口</a></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="overline">本地控制台 / 状态视图</span><h1>插件服务器</h1></div>
          <div className="top-actions">
            <button className="icon-button" title="刷新数据" aria-label="刷新数据" onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
            <button className="icon-button" title="切换主题" aria-label="切换主题" onClick={cycleTheme}>{themeIcon}</button>
            <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={16} /></button>
          </div>
        </header>

        {message && <div className={`toast ${message.kind}`} role="status">{message.kind === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}{message.text}<button onClick={() => setMessage(null)} aria-label="关闭提示"><X size={14} /></button></div>}
        {error && <section className="error-strip"><AlertCircle size={17} /><div><strong>无法读取本地服务器</strong><span>{error}</span></div><button className="button secondary" onClick={() => void refresh(true)}>重试</button></section>}

        <div className="content">
          <section id="overview" className="hero-grid"><div><span className="section-index">01 / 运行概览</span><h2>{status?.connected ? '控制连接正常' : '等待控制连接'}</h2><p>{status?.connected ? '服务器已连接到 Worker，插件命令可以从管理端下发。' : '本地服务正在运行，但尚未建立 Worker 控制 WebSocket。'}</p></div><div className={`status-seal ${status?.connected ? 'online' : 'offline'}`}><span>{status?.connected ? 'ONLINE' : 'OFFLINE'}</span><div>{status?.connected ? <Wifi size={34} /> : <WifiOff size={34} />}</div><small>{lastUpdated ? `更新于 ${formatTime(lastUpdated)}` : '正在获取状态'}</small></div></section>

          <section className="metric-grid" aria-label="运行指标"><Metric label="已发现插件" value={diagnostics?.pluginCount ?? (loading ? '—' : plugins.length)} icon={<FileCode2 size={16} />} /><Metric label="已启用" value={enabledCount} icon={<Cpu size={16} />} accent /><Metric label="失败状态" value={diagnostics?.failedPluginCount ?? 0} icon={<CircleSlash size={16} />} danger={Boolean(diagnostics?.failedPluginCount)} /><Metric label="本地端口" value={status?.port ?? '—'} icon={<Network size={16} />} /></section>

          <section id="plugins" className="section-block"><div className="section-heading"><div><span className="section-index">02 / 插件目录</span><h2>已发现插件</h2></div><span className="section-meta">{plugins.length} 个条目</span></div>{loading && <LoadingState />}{!loading && !error && plugins.length === 0 && <EmptyState title="尚未发现插件" body="将包含 manifest.json 的插件目录配置到服务器后，插件会出现在这里。" />}{!loading && !error && plugins.length > 0 && <div className="plugin-list">{plugins.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} busy={busyPlugin === plugin.id} onAction={(action) => void runAction(plugin, action)} onHealth={() => void runHealth(plugin)} />)}</div>}</section>

          <section id="setup" className="section-block setup-section">
            <div className="section-heading"><div><span className="section-index">03 / 连接设置</span><h2>绑定管理</h2></div><span className="status-badge positive"><span className="status-dot" />已配置</span></div>
            <div className="setup-grid">
              <div className="setup-copy"><h3>服务器已完成绑定</h3><p>{status?.systemCredentialsAvailable && !status.credentialFile ? '长期凭据已保存到系统凭据存储。服务器重启后会自动恢复控制连接。' : '长期凭据已保存到本地加密文件。服务器重启后会自动恢复控制连接。'}</p><div className="command-block"><span>id</span><code>{status?.serverId ?? '尚未读取服务器标识'}</code></div><span className="text-link">{status?.systemCredentialsAvailable && !status.credentialFile ? '凭据存储：系统凭据存储' : `凭据文件：${status?.credentialFile ?? '未提供路径'}`}</span></div>
              <div className="setup-state credential-state"><Terminal size={22} /><strong>管理访问密钥</strong><span>{status?.systemCredentialsAvailable && !status.credentialFile ? '当前使用系统凭据存储；操作时无需填写口令。' : '当前使用口令加密文件；轮换和撤销时需要验证文件口令。'}</span><label className="credential-password">凭据文件加密口令<input type="password" value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} placeholder={status?.systemCredentialsAvailable && !status.credentialFile ? '系统凭据存储可留空' : '请输入凭据文件口令'} /></label><div className="credential-actions"><button className="button secondary with-icon" onClick={() => void runCredentialAction('rotate')} disabled={credentialBusy !== null}>{credentialBusy === 'rotate' && <LoaderCircle size={14} className="spin" />}轮换密钥</button><button className="button danger-button with-icon" onClick={() => void runCredentialAction('revoke')} disabled={credentialBusy !== null}>{credentialBusy === 'revoke' && <LoaderCircle size={14} className="spin" />}撤销绑定</button></div></div>
            </div>
          </section>

          <section id="logs" className="section-block"><div className="section-heading"><div><span className="section-index">04 / 运行日志</span><h2>最近日志</h2></div><span className="section-meta">保留最近 {logs.length} 条</span></div>{logs.length === 0 ? <EmptyState title="暂无日志" body="插件或服务器产生日志后，会在这里显示最近的运行记录。" /> : <div className="log-list">{logs.slice().reverse().map((log, index) => <div className="log-row" key={`${log.timestamp}-${index}`}><span className={`log-level level-${log.level}`}>{log.level >= 3 ? 'ERR' : log.level === 2 ? 'WARN' : 'INFO'}</span><time>{log.timestamp}</time><span>{log.message}</span></div>)}</div>}</section>
        </div>
        <footer className="footer"><span>Plugmesh Local Server</span><span>API: {status?.service ?? 'unavailable'} · localhost only</span></footer>
      </main>
    </div>
  )
}

function AccessShell({ theme, themeIcon, onTheme, error, children }: { theme: 'dark' | 'light'; themeIcon: React.ReactNode; onTheme: () => void; error: string | null; children: React.ReactNode }) {
  return <div className={`local-app access-shell theme-${theme}`}><header className="access-header"><div className="brand access-brand"><span className="brand-mark"><Network size={17} /></span><div><strong>PLUGMESH</strong><span>LOCAL SERVER</span></div></div><button className="icon-button" title="切换主题" aria-label="切换主题" onClick={onTheme}>{themeIcon}</button></header><main className="access-main"><div className="access-context"><span className="section-index">LOCALHOST / 127.0.0.1</span><h1>本地插件服务器</h1><div className="access-rule"><span /></div><p>会话仅保存在当前服务器进程中。</p></div><div className="access-panel">{error && <div className="access-error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}{children}</div></main></div>
}

function AccessHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="access-heading"><span>{icon}</span><h2>{title}</h2></div>
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'wide-field' : undefined}><span>{label}</span>{children}</label>
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

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

export default App
