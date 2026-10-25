import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
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
  Languages,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Network,
  Pencil,
  Power,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n, { storeLanguage } from './i18n'
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
  portMappings?: LocalMapping[]
}

interface LocalMapping {
  name: string
  protocol: string
  listenPort: number
  targetServerId: string
  targetServer: string
  targetHost: string
  targetPort: number
  state: string
  enabled: boolean
}

interface MappingTarget {
  id: string
  name: string
  status: string
  plugins: RemotePlugin[]
  portMappings: RemotePortMapping[]
  pluginDomains?: Record<string, string>
}

interface RemotePlugin {
  id: string
  name: string
  version: string
  state: string
  capabilities: { http: boolean; websocket: boolean; sse: boolean; fileStream: boolean }
  domain?: string
}

interface RemotePortMapping {
  name: string
  protocol: string
  targetHost: string
  targetPort: number
  enabled: boolean
  state: string
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
}

interface LocalLog {
  timestamp: string
  level: number
  message: string
}

class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const data = await response.json().catch(() => null) as { error?: string; code?: string } | null
  if (!response.ok) throw new RequestError(data?.error ?? '', response.status, data?.code)
  return data as T
}

// 本地服务返回的 error 文本面向开发；UI 只按错误码或状态码给出本地化文案，避免英文外泄。
const errorCodeKeys: Record<string, string> = {
  password_too_short: 'errors.passwordTooShort',
  password_mismatch: 'errors.passwordMismatch',
  password_setup_failed: 'errors.passwordSetupFailed',
  registration_failed: 'errors.bindFailed',
  plugin_action_failed: 'errors.pluginActionFailed',
  health_check_failed: 'errors.healthCheckFailed',
  credential_action_failed: 'errors.credentialActionFailed',
}

const httpErrorKey = (status: number) => {
  if (status === 401) return 'errors.http.unauthorized'
  if (status === 403) return 'errors.http.forbidden'
  if (status === 404) return 'errors.http.notFound'
  if (status === 409) return 'errors.http.conflict'
  if (status === 429) return 'errors.http.rateLimited'
  if (status >= 500) return 'errors.http.serverError'
  return 'errors.http.failed'
}

function errorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof RequestError) {
    const key = error.code ? errorCodeKeys[error.code] ?? `errors.code.${error.code}` : undefined
    if (key && i18n.exists(key)) return i18n.t(key)
    if (/[\u4e00-\u9fa5]/.test(error.message)) return error.message
    return i18n.t(httpErrorKey(error.status), { status: error.status })
  }
  if (error instanceof Error && i18n.exists(error.message)) return i18n.t(error.message)
  return i18n.t(fallbackKey)
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(i18n.resolvedLanguage === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState('overview')
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
  const [mappings, setMappings] = useState<LocalMapping[]>([])
  const [mappingTargets, setMappingTargets] = useState<MappingTarget[]>([])
  const [mappingTargetPasswords, setMappingTargetPasswords] = useState<Record<string, string>>({})
  const [mappingTargetAuthBusy, setMappingTargetAuthBusy] = useState<string | null>(null)
  const [mappingTargetAuthorized, setMappingTargetAuthorized] = useState<Record<string, boolean>>({})
  const [mappingTargetsLoading, setMappingTargetsLoading] = useState(false)
  const mappingTargetsInFlight = useRef(false)
  const [mappingBusy, setMappingBusy] = useState(false)
  const [editingMapping, setEditingMapping] = useState('')
  const [mappingForm, setMappingForm] = useState({ name: '', protocol: 'tcp', listenPort: '', targetServerId: '', targetHost: '127.0.0.1', targetPort: '', targetPassword: '', enabled: true })
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
      setSessionError(errorMessage(cause, 'errors.localServerUnavailable'))
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
      setMappings(nextStatus.portMappings ?? [])
      setLogs(nextLogs.logs ?? [])
      setError(null)
      setLastUpdated(new Date())
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) void loadSession()
      else setError(errorMessage(cause, 'errors.localServerUnavailable'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadSession])

  const refreshMappingTargets = useCallback(async (silent = false) => {
    if (mappingTargetsInFlight.current) return
    mappingTargetsInFlight.current = true
    setMappingTargetsLoading(true)
    try {
      const result = await request<{ targets: MappingTarget[] }>('/api/mappings/targets')
      const nextTargets = (result.targets ?? []).map((target) => ({ ...target, plugins: (target.plugins ?? []).map((plugin) => ({ ...plugin, domain: target.pluginDomains?.[plugin.id] })), portMappings: target.portMappings ?? [] }))
      setMappingTargets(nextTargets)
      setMappingTargetAuthorized((current) => Object.fromEntries(Object.entries(current).filter(([id]) => nextTargets.some((target) => target.id === id && target.status === 'online'))))
      if (!mappingForm.targetServerId && nextTargets.length) setMappingForm((current) => ({ ...current, targetServerId: nextTargets[0].id }))
    } catch (cause) {
      if (!silent) setMessage({ kind: 'error', text: errorMessage(cause, 'mappings.targetsFailed') })
    } finally {
      mappingTargetsInFlight.current = false
      setMappingTargetsLoading(false)
    }
  }, [mappingForm.targetServerId])

  const isRemoteProxyMapped = (target: MappingTarget, proxy: RemotePortMapping) => mappings.some((mapping) => mapping.targetServerId === target.id && mapping.targetHost === proxy.targetHost && mapping.targetPort === proxy.targetPort && mapping.protocol === proxy.protocol)

  const mapRemoteProxy = async (target: MappingTarget, proxy: RemotePortMapping) => {
    if (mappingBusy) return
    const usedPorts = new Set(mappings.map((mapping) => mapping.listenPort))
    const listenPort = Array.from({ length: 1000 }, (_, index) => 30000 + index).find((port) => !usedPorts.has(port))
    if (!listenPort) {
      setMessage({ kind: 'error', text: t('mappings.noLocalPort') })
      return
    }
    const name = `${target.name}-${proxy.name}`.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || `proxy-${proxy.targetPort}`
    setMappingBusy(true)
    try {
      await request('/api/mappings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, protocol: proxy.protocol, listenPort, targetServerId: target.id, targetHost: proxy.targetHost, targetPort: proxy.targetPort, targetPassword: '', enabled: true }) })
      await refresh(true)
      setMessage({ kind: 'success', text: t('mappings.proxyMapped', { name, port: listenPort }) })
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'mappings.proxyMapFailed') })
    } finally {
      setMappingBusy(false)
    }
  }

  const authorizeMappingTarget = async (target: MappingTarget) => {
    const password = mappingTargetPasswords[target.id] ?? ''
    if (!password) {
      setMessage({ kind: 'error', text: t('mappings.targetPasswordRequired') })
      return
    }
    setMappingTargetAuthBusy(target.id)
    try {
      await request(`/api/mappings/targets/${encodeURIComponent(target.id)}/authorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetPassword: password }) })
      setMappingTargetPasswords((current) => ({ ...current, [target.id]: '' }))
      setMappingTargetAuthorized((current) => ({ ...current, [target.id]: true }))
      setMessage({ kind: 'success', text: t('mappings.targetAuthorized', { name: target.name }) })
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'mappings.targetAuthorizeFailed') })
    } finally {
      setMappingTargetAuthBusy(null)
    }
  }

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
    setSessionError(t('errors.restartTimeout'))
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
      .catch((cause) => setSessionError(errorMessage(cause, 'errors.setupStatusFailed')))
  }, [session])
  useEffect(() => {
    if (!session?.authenticated) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    void refreshMappingTargets(true)
    const targetTimer = window.setInterval(() => void refreshMappingTargets(true), 15000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(targetTimer)
    }
  }, [refresh, refreshMappingTargets, session?.authenticated])
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
  useEffect(() => {
    if (!session?.authenticated || !session.configured || session.passwordSetupRequired) return
    const sections = ['overview', 'plugins', 'mappings', 'setup', 'logs'].map((id) => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
      if (visible) setActiveSection(visible.target.id)
    }, { rootMargin: '-12% 0px -68% 0px', threshold: [0, 0.15, 0.4, 0.7] })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [session?.authenticated, session?.configured, session?.passwordSetupRequired])

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
      setSessionError(errorMessage(cause, 'errors.loginFailed'))
    } finally {
      setAccessBusy(false)
    }
  }

  const submitMigration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (migrationForm.password.length < 8 || migrationForm.password !== migrationForm.passwordConfirmation) {
      setSessionError(t(migrationForm.password.length < 8 ? 'errors.passwordTooShort' : 'errors.passwordMismatch'))
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
      setSessionError(errorMessage(cause, 'errors.passwordSetupFailed'))
    } finally {
      setAccessBusy(false)
    }
  }

  const submitSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (setupForm.localUiPassword.length < 8 || setupForm.localUiPassword !== setupForm.localUiPasswordConfirmation) {
      setSessionError(t(setupForm.localUiPassword.length < 8 ? 'errors.passwordTooShort' : 'errors.passwordMismatch'))
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
      setMessage({ kind: 'success', text: t('setup.success') })
      await waitForRestart()
    } catch (cause) {
      setSessionError(errorMessage(cause, 'errors.bindFailed'))
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
      setMessage({ kind: 'success', text: t('plugins.stateChanged', { name: plugin.name, state: t(`state.${result.state}`, { defaultValue: result.state }) }) })
      await refresh()
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'errors.pluginActionFailed') })
    } finally {
      setBusyPlugin(null)
    }
  }

  const saveMapping = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMappingBusy(true)
    try {
      const endpoint = editingMapping ? `/api/mappings/${encodeURIComponent(editingMapping)}` : '/api/mappings'
      await request(endpoint, { method: editingMapping ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...mappingForm, listenPort: Number(mappingForm.listenPort), targetPort: Number(mappingForm.targetPort) }) })
      setMappingForm((current) => ({ ...current, name: '', listenPort: '', targetPort: '', targetPassword: '' }))
      setEditingMapping('')
      await refresh(true)
      setMessage({ kind: 'success', text: t('mappings.saved') })
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'mappings.saveFailed') })
    } finally {
      setMappingBusy(false)
    }
  }

  const deleteMapping = async (mapping: LocalMapping) => {
    setMappingBusy(true)
    try {
      await request(`/api/mappings/${encodeURIComponent(mapping.name)}`, { method: 'DELETE' })
      await refresh(true)
      setMessage({ kind: 'success', text: t('mappings.deleted') })
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'mappings.deleteFailed') })
    } finally {
      setMappingBusy(false)
    }
  }

  const toggleMapping = async (mapping: LocalMapping) => {
    setMappingBusy(true)
    try {
      await request(`/api/mappings/${encodeURIComponent(mapping.name)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: mapping.name, protocol: mapping.protocol, listenPort: mapping.listenPort, targetServerId: mapping.targetServerId, targetHost: mapping.targetHost, targetPort: mapping.targetPort, enabled: !mapping.enabled }) })
      await refresh(true)
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'mappings.saveFailed') })
    } finally {
      setMappingBusy(false)
    }
  }

  const runHealth = async (plugin: LocalPlugin) => {
    setBusyPlugin(plugin.id)
    try {
      const result = await request<{ ok: boolean; status: number; bodySize: number }>(`/api/plugins/${encodeURIComponent(plugin.id)}/health`)
      setMessage({ kind: 'success', text: t('plugins.healthPassed', { name: plugin.name, status: result.status }) })
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'errors.healthCheckFailed') })
    } finally {
      setBusyPlugin(null)
    }
  }

  const runCredentialAction = async (action: 'rotate' | 'revoke') => {
    if (action === 'revoke' && !window.confirm(t('binding.revokeConfirm'))) return
    setCredentialBusy(action)
    try {
      await request(`/api/credentials/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialPassword }),
      })
      setCredentialPassword('')
      setMessage({ kind: 'success', text: t(action === 'rotate' ? 'binding.rotateDone' : 'binding.revokeDone') })
      if (action === 'revoke') await waitForRestart()
      else await refresh(true)
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause, 'errors.credentialActionFailed') })
    } finally {
      setCredentialBusy(null)
    }
  }

  if (sessionLoading || !session) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <div className="access-loading"><LoaderCircle size={22} className="spin" /><strong>{t('access.loading')}</strong></div>
    </AccessShell>
  }

  if (!session.configured) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <form className="access-form access-form-wide" onSubmit={(event) => void submitSetup(event)}>
        <AccessHeading icon={<Network size={20} />} title={t('setup.title')} />
        <div className="access-fields two-columns">
          <Field label={t('setup.workerUrl')}><input value={setupForm.workerUrl} onChange={(event) => setSetupForm((current) => ({ ...current, workerUrl: event.target.value }))} placeholder="https://console.example.com" required /></Field>
          <Field label={t('setup.serverName')}><input value={setupForm.serverName} onChange={(event) => setSetupForm((current) => ({ ...current, serverName: event.target.value }))} required /></Field>
          <Field label={t('setup.registrationCode')}><input value={setupForm.registrationCode} onChange={(event) => setSetupForm((current) => ({ ...current, registrationCode: event.target.value }))} required /></Field>
          <Field label={t('setup.credentialFile')}><input value={setupForm.credentialFile} onChange={(event) => setSetupForm((current) => ({ ...current, credentialFile: event.target.value }))} required={!status?.systemCredentialsAvailable} placeholder={status?.systemCredentialsAvailable ? t('setup.credentialFilePlaceholder') : undefined} /></Field>
          <Field label={t('setup.localUiPassword')}><input type="password" autoComplete="new-password" value={setupForm.localUiPassword} onChange={(event) => setSetupForm((current) => ({ ...current, localUiPassword: event.target.value }))} required /></Field>
          <Field label={t('setup.confirmPassword')}><input type="password" autoComplete="new-password" value={setupForm.localUiPasswordConfirmation} onChange={(event) => setSetupForm((current) => ({ ...current, localUiPasswordConfirmation: event.target.value }))} required /></Field>
          <Field label={t('setup.credentialPassword')} wide><input type="password" autoComplete="new-password" value={setupForm.credentialPassword} onChange={(event) => setSetupForm((current) => ({ ...current, credentialPassword: event.target.value }))} required={!status?.systemCredentialsAvailable || Boolean(setupForm.credentialFile)} placeholder={status?.systemCredentialsAvailable && !setupForm.credentialFile ? t('setup.credentialPasswordSystemPlaceholder') : undefined} /></Field>
        </div>
        <button className="button primary with-icon" type="submit" disabled={accessBusy || !status}>{accessBusy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{t('setup.submit')}</button>
      </form>
    </AccessShell>
  }

  if (session.passwordSetupRequired) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <form className="access-form" onSubmit={(event) => void submitMigration(event)}>
        <AccessHeading icon={<ShieldCheck size={20} />} title={t('migration.title')} />
        <p className="access-note">{t('migration.note')}</p>
        <div className="access-fields">
          <Field label={t('setup.localUiPassword')}><input type="password" autoComplete="new-password" value={migrationForm.password} onChange={(event) => setMigrationForm((current) => ({ ...current, password: event.target.value }))} required /></Field>
          <Field label={t('setup.confirmPassword')}><input type="password" autoComplete="new-password" value={migrationForm.passwordConfirmation} onChange={(event) => setMigrationForm((current) => ({ ...current, passwordConfirmation: event.target.value }))} required /></Field>
          <Field label={t('setup.credentialPassword')}><input type="password" autoComplete="current-password" value={migrationForm.credentialPassword} onChange={(event) => setMigrationForm((current) => ({ ...current, credentialPassword: event.target.value }))} placeholder={t('setup.credentialPasswordSystemPlaceholder')} /></Field>
        </div>
        <button className="button primary with-icon" type="submit" disabled={accessBusy}>{accessBusy ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}{t('migration.submit')}</button>
      </form>
    </AccessShell>
  }

  if (!session.authenticated) {
    return <AccessShell theme={effectiveTheme} themeIcon={themeIcon} onTheme={cycleTheme} error={sessionError}>
      <form className="access-form" onSubmit={(event) => void submitLogin(event)}>
        <AccessHeading icon={<KeyRound size={20} />} title={t('login.title')} />
        <div className="access-fields">
          <Field label={t('setup.localUiPassword')}><input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoFocus required /></Field>
        </div>
        <button className="button primary with-icon" type="submit" disabled={accessBusy}>{accessBusy ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />}{t('login.submit')}</button>
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
          <div className="connection-copy"><span>{t('connector.label')}</span><strong>{status?.connected ? t('connector.online') : t('connector.offline')}</strong></div>
          <div className="connection-detail">{status?.serverId ?? t('common.serverIdMissing')}</div>
        </div>
        <nav className="side-nav" aria-label={t('nav.aria')}>
          <a className={`side-link ${activeSection === 'overview' ? 'active' : ''}`} href="#overview"><Activity size={15} />{t('nav.overview')}</a>
          <a className={`side-link ${activeSection === 'plugins' ? 'active' : ''}`} href="#plugins"><FileCode2 size={15} />{t('nav.plugins')}<span>{plugins.length}</span></a>
          <a className={`side-link ${activeSection === 'mappings' ? 'active' : ''}`} href="#mappings"><Network size={15} />{t('nav.mappings')}<span>{mappings.length}</span></a>
          <a className={`side-link ${activeSection === 'setup' ? 'active' : ''}`} href="#setup"><Settings2 size={15} />{t('nav.settings')}</a>
          <a className={`side-link ${activeSection === 'logs' ? 'active' : ''}`} href="#logs"><Terminal size={15} />{t('nav.logs')}<span>{logs.length}</span></a>
        </nav>
        <div className="rail-bottom"><div className="local-only"><HardDrive size={14} /><span>{t('nav.localOnly')}<br /><strong>127.0.0.1:{status?.port ?? '----'}</strong></span></div><a className="docs-link" href="#setup"><Terminal size={14} />{t('nav.cli')}</a></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="overline">{t('shell.overline')}</span><h1>{t('shell.title')}</h1></div>
          <div className="top-actions">
            <button className="icon-button" title={t('shell.refresh')} aria-label={t('shell.refresh')} onClick={() => void refresh(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
            <button className="icon-button" title={t('shell.theme')} aria-label={t('shell.theme')} onClick={cycleTheme}>{themeIcon}</button>
            <LanguageButton />
            <button className="icon-button" title={t('shell.logout')} aria-label={t('shell.logout')} onClick={() => void logout()}><LogOut size={16} /></button>
          </div>
        </header>

        {message && <div className={`toast ${message.kind}`} role="status">{message.kind === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}{message.text}<button onClick={() => setMessage(null)} aria-label={t('common.closeToast')}><X size={14} /></button></div>}
        {error && <section className="error-strip"><AlertCircle size={17} /><div><strong>{t('shell.readError')}</strong><span>{error}</span></div><button className="button secondary" onClick={() => void refresh(true)}>{t('common.retry')}</button></section>}

        <div className="content">
          <section id="overview" className="hero-grid"><div><span className="section-index">{`01 / ${t('nav.overview')}`}</span><h2>{status?.connected ? t('overview.connectedTitle') : t('overview.offlineTitle')}</h2><p>{status?.connected ? t('overview.connectedBody') : t('overview.offlineBody')}</p></div><div className={`status-seal ${status?.connected ? 'online' : 'offline'}`}><span>{status?.connected ? t('overview.online') : t('overview.offline')}</span><div>{status?.connected ? <Wifi size={34} /> : <WifiOff size={34} />}</div><small>{lastUpdated ? t('common.updatedAt', { time: formatTime(lastUpdated) }) : t('common.statusLoading')}</small></div></section>

          <section className="metric-grid" aria-label={t('metrics.aria')}><Metric label={t('metrics.plugins')} value={diagnostics?.pluginCount ?? (loading ? t('common.unavailable') : plugins.length)} icon={<FileCode2 size={16} />} /><Metric label={t('metrics.enabled')} value={enabledCount} icon={<Cpu size={16} />} accent /><Metric label={t('metrics.failed')} value={diagnostics?.failedPluginCount ?? 0} icon={<CircleSlash size={16} />} danger={Boolean(diagnostics?.failedPluginCount)} /><Metric label={t('metrics.port')} value={status?.port ?? t('common.unavailable')} icon={<Network size={16} />} /></section>

          <section id="plugins" className="section-block"><div className="section-heading"><div><span className="section-index">{t('plugins.index')}</span><h2>{t('plugins.title')}</h2></div><span className="section-meta">{t('plugins.count', { count: plugins.length })} · {t('plugins.loadedCount', { count: diagnostics?.loadedPluginCount ?? 0 })}</span></div>{loading && <LoadingState />}{!loading && !error && plugins.length === 0 && <EmptyState title={t('plugins.emptyTitle')} body={t('plugins.emptyBody')} />}{!loading && !error && plugins.length > 0 && <div className="plugin-list">{plugins.map((plugin) => <PluginRow key={plugin.id} plugin={plugin} busy={busyPlugin === plugin.id} onAction={(action) => void runAction(plugin, action)} onHealth={() => void runHealth(plugin)} />)}</div>}</section>

          <section id="mappings" className="section-block">
            <div className="section-heading"><div><span className="section-index">{t('mappings.index')}</span><h2>{t('mappings.title')}</h2></div><button className="button secondary with-icon" onClick={() => void refreshMappingTargets()} disabled={mappingTargetsLoading}><RefreshCw size={14} className={mappingTargetsLoading ? 'spin' : ''} />{t('mappings.refreshTargets')}</button></div>
                         {mappingTargets.length > 0 && <div className="mapping-target-list"><div className="mapping-target-list-heading"><strong>{t('mappings.targetTableTitle')}</strong><span>{t('mappings.targetTableBody')}</span></div>{mappingTargets.map((target) => <div className="mapping-target-row" key={target.id}><div className="mapping-target-summary"><strong>{target.name}</strong><span className={`status-badge ${target.status === 'online' ? 'positive' : 'warning'}`}>{target.status}</span>{mappingTargetAuthorized[target.id] && <span className="status-badge positive">{t('mappings.authorized')}</span>}<span>{t('mappings.remotePlugins', { count: target.plugins.length })} · {t('mappings.remoteProxies', { count: target.portMappings.length })}</span></div><label><span className="sr-only">{t('mappings.targetPassword')}</span><input type="password" autoComplete="new-password" placeholder={t('mappings.targetPasswordPlaceholder')} value={mappingTargetPasswords[target.id] ?? ''} onChange={(event) => setMappingTargetPasswords((current) => ({ ...current, [target.id]: event.target.value }))} /></label><button className="button secondary with-icon" type="button" onClick={() => void authorizeMappingTarget(target)} disabled={mappingTargetAuthBusy !== null || target.status !== 'online'}>{mappingTargetAuthBusy === target.id ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}{t(mappingTargetAuthorized[target.id] ? 'mappings.reauthorizeTarget' : 'mappings.authorizeTarget')}</button>{(target.plugins.length > 0 || target.portMappings.length > 0) && <div className="mapping-target-details">{target.plugins.map((plugin) => <span className="mapping-target-chip" key={plugin.id}><FileCode2 size={12} />{plugin.name}{plugin.capabilities.http && (plugin.domain ? <a className="mapping-target-link" href={`https://${plugin.domain}`} target="_blank" rel="noreferrer"> · {plugin.domain}</a> : ` · ${t('mappings.httpPlugin')}`)}</span>)}{target.portMappings.filter((proxy) => proxy.enabled && proxy.protocol !== 'http').map((proxy) => <button className="mapping-target-proxy" key={proxy.name} type="button" onClick={() => void mapRemoteProxy(target, proxy)} disabled={mappingBusy || mappingTargetAuthBusy !== null || isRemoteProxyMapped(target, proxy)}><Network size={12} />{proxy.name} · {proxy.protocol.toUpperCase()}:{proxy.targetPort} · {isRemoteProxyMapped(target, proxy) ? t('mappings.proxyAlreadyMapped') : t('mappings.mapProxy')}</button>)}</div>}</div>)}</div>}
             <form className="mapping-form" onSubmit={(event) => void saveMapping(event)}>
              <label><span>{t('mappings.name')}</span><input required maxLength={64} pattern="[A-Za-z0-9_-]+" value={mappingForm.name} onChange={(event) => setMappingForm({ ...mappingForm, name: event.target.value })} /></label>
              <label><span>{t('mappings.protocol')}</span><select value={mappingForm.protocol} onChange={(event) => setMappingForm({ ...mappingForm, protocol: event.target.value })}><option value="tcp">TCP</option><option value="http">HTTP</option><option value="websocket">WebSocket</option></select></label>
              <label><span>{t('mappings.listenPort')}</span><input required type="number" min="1" max="65535" value={mappingForm.listenPort} onChange={(event) => setMappingForm({ ...mappingForm, listenPort: event.target.value })} /></label>
              <label><span>{t('mappings.targetServer')}</span><select required value={mappingForm.targetServerId} onChange={(event) => setMappingForm({ ...mappingForm, targetServerId: event.target.value })}><option value="">{t('mappings.selectTarget')}</option>{mappingTargets.filter((target) => target.status === 'online').map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
              <label><span>{t('mappings.targetHost')}</span><input required maxLength={253} value={mappingForm.targetHost} onChange={(event) => setMappingForm({ ...mappingForm, targetHost: event.target.value })} /></label>
              <label><span>{t('mappings.targetPort')}</span><input required type="number" min="1" max="65535" value={mappingForm.targetPort} onChange={(event) => setMappingForm({ ...mappingForm, targetPort: event.target.value })} /></label>
              <label><span>{t('mappings.targetPassword')}</span><input type="password" autoComplete="new-password" value={mappingForm.targetPassword} onChange={(event) => setMappingForm({ ...mappingForm, targetPassword: event.target.value })} /></label>
              <button className="button primary with-icon" type="submit" disabled={mappingBusy || !mappingForm.targetServerId}>{editingMapping ? <Pencil size={14} /> : <Plus size={14} />}{t(editingMapping ? 'mappings.update' : 'mappings.add')}</button>
              {editingMapping && <button className="button secondary" type="button" onClick={() => { setEditingMapping(''); setMappingForm({ name: '', protocol: 'tcp', listenPort: '', targetServerId: '', targetHost: '127.0.0.1', targetPort: '', targetPassword: '', enabled: true }) }}>{t('common.cancel')}</button>}
            </form>
            {mappings.length === 0 ? <EmptyState title={t('mappings.emptyTitle')} body={t('mappings.emptyBody')} /> : <div className="mapping-list">{mappings.map((mapping) => <div className="mapping-row" key={mapping.name}><div className="mapping-endpoint"><strong>{mapping.name}</strong><span>{mapping.protocol.toUpperCase()} · 127.0.0.1:{mapping.listenPort} → {mapping.targetHost}:{mapping.targetPort}</span></div><div className="mapping-target"><span>{mapping.targetServer}</span><span className={`status-badge ${mapping.state === 'listening' ? 'positive' : 'warning'}`}>{t(mapping.state === 'listening' ? 'mappings.listening' : 'mappings.stopped')}</span></div><div className="mapping-actions"><button className="icon-button" title={t(mapping.enabled ? 'mappings.disable' : 'mappings.enable')} aria-label={t(mapping.enabled ? 'mappings.disable' : 'mappings.enable')} onClick={() => void toggleMapping(mapping)} disabled={mappingBusy}><Power size={15} /></button><button className="icon-button" title={t('mappings.edit')} aria-label={t('mappings.edit')} onClick={() => { setEditingMapping(mapping.name); setMappingForm({ name: mapping.name, protocol: mapping.protocol, listenPort: String(mapping.listenPort), targetServerId: mapping.targetServerId, targetHost: mapping.targetHost, targetPort: String(mapping.targetPort), targetPassword: '', enabled: mapping.enabled }); void refreshMappingTargets() }} disabled={mappingBusy}><Pencil size={15} /></button><button className="icon-button danger-icon" title={t('mappings.delete')} aria-label={t('mappings.delete')} onClick={() => void deleteMapping(mapping)} disabled={mappingBusy}><Trash2 size={15} /></button></div></div>)}</div>}
          </section>

          <section id="setup" className="section-block setup-section">
            <div className="section-heading"><div><span className="section-index">{t('binding.index')}</span><h2>{t('binding.title')}</h2></div><span className="status-badge positive"><span className="status-dot" />{t('binding.configured')}</span></div>
            <div className="setup-grid">
              <div className="setup-copy"><h3>{t('binding.doneTitle')}</h3><p>{status?.systemCredentialsAvailable && !status.credentialFile ? t('binding.systemStoreBody') : t('binding.fileStoreBody')}</p><div className="command-block"><span>id</span><code>{status?.serverId ?? t('common.serverIdMissing')}</code></div><span className="text-link">{status?.systemCredentialsAvailable && !status.credentialFile ? t('binding.storeSystem') : t('binding.storeFile', { path: status?.credentialFile ?? t('binding.noPath') })}</span></div>
              <div className="setup-state credential-state"><Terminal size={22} /><strong>{t('binding.manage')}</strong><span>{status?.systemCredentialsAvailable && !status.credentialFile ? t('binding.systemStoreHint') : t('binding.fileStoreHint')}</span><label className="credential-password">{t('binding.credentialPassword')}<input type="password" value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} placeholder={status?.systemCredentialsAvailable && !status.credentialFile ? t('binding.systemStorePlaceholder') : t('binding.passwordPlaceholder')} /></label><div className="credential-actions"><button className="button secondary with-icon" onClick={() => void runCredentialAction('rotate')} disabled={credentialBusy !== null}>{credentialBusy === 'rotate' && <LoaderCircle size={14} className="spin" />}{t('binding.rotate')}</button><button className="button danger-button with-icon" onClick={() => void runCredentialAction('revoke')} disabled={credentialBusy !== null}>{credentialBusy === 'revoke' && <LoaderCircle size={14} className="spin" />}{t('binding.revoke')}</button></div></div>
            </div>
          </section>

          <section id="logs" className="section-block"><div className="section-heading"><div><span className="section-index">{t('logs.index')}</span><h2>{t('logs.title')}</h2></div><span className="section-meta">{t('logs.count', { count: logs.length })}</span></div>{logs.length === 0 ? <EmptyState title={t('logs.emptyTitle')} body={t('logs.emptyBody')} /> : <div className="log-list">{logs.slice().reverse().map((log, index) => <div className="log-row" key={`${log.timestamp}-${index}`}><span className={`log-level level-${log.level}`}>{log.level >= 3 ? 'ERR' : log.level === 2 ? 'WARN' : 'INFO'}</span><time>{log.timestamp}</time><span>{log.message}</span></div>)}</div>}</section>
        </div>
        <footer className="footer"><span>Plugmesh Local Server</span><span>{t('common.footerService', { service: status?.service ?? 'unavailable' })}</span></footer>
      </main>
    </div>
  )
}

function AccessShell({ theme, themeIcon, onTheme, error, children }: { theme: 'dark' | 'light'; themeIcon: React.ReactNode; onTheme: () => void; error: string | null; children: React.ReactNode }) {
  const { t } = useTranslation()
  return <div className={`local-app access-shell theme-${theme}`}><header className="access-header"><div className="brand access-brand"><span className="brand-mark"><Network size={17} /></span><div><strong>PLUGMESH</strong><span>LOCAL SERVER</span></div></div><LanguageButton /><button className="icon-button" title={t('shell.theme')} aria-label={t('shell.theme')} onClick={onTheme}>{themeIcon}</button></header><main className="access-main"><div className="access-context"><span className="section-index">LOCALHOST / 127.0.0.1</span><h1>{t('access.title')}</h1><div className="access-rule"><span /></div><p>{t('access.note')}</p></div><div className="access-panel">{error && <div className="access-error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}{children}</div></main></div>
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
  const { t } = useTranslation()
  const canEnable = plugin.state === 'loaded' || plugin.state === 'disabled'
  const canDisable = plugin.state === 'enabled'
  const canUnload = plugin.state !== 'discovered' && plugin.state !== 'unloaded'
  return <article className="plugin-row"><div className="plugin-main"><div className="plugin-icon"><FileCode2 size={18} /></div><div className="plugin-copy"><div className="plugin-title"><h3>{plugin.name}</h3><span className={`status-badge ${stateTone(plugin.state)}`}><span className="status-dot" />{t(`state.${plugin.state}`, { defaultValue: plugin.state })}</span></div><span className="plugin-id">{plugin.id} · v{plugin.version} · ABI {plugin.abiVersion}</span><span className="plugin-meta">{t('plugins.library')}: {plugin.library} · {t('plugins.healthPath')}: {plugin.healthPath} · {t('plugins.permissions')}: {plugin.permissions.length > 0 ? plugin.permissions.join(', ') : t('plugins.noPermissions')}</span><div className="capability-list">{plugin.capabilities.http && <span>HTTP</span>}{plugin.capabilities.websocket && <span>WebSocket</span>}{plugin.capabilities.sse && <span>SSE</span>}{plugin.capabilities.fileStream && <span>{t('plugins.fileStream')}</span>}</div></div></div><div className="plugin-actions">{busy ? <span className="action-loading"><LoaderCircle size={16} className="spin" />{t('common.processing')}</span> : <>{plugin.state === 'enabled' && <ActionButton label={t('plugins.health')} onClick={onHealth} />}{plugin.state === 'discovered' || plugin.state === 'unloaded' ? <ActionButton label={t('plugins.load')} onClick={() => onAction('load')} /> : <ActionButton label={t('plugins.reload')} onClick={() => onAction('reload')} />}{canEnable && <ActionButton label={t('plugins.enable')} onClick={() => onAction('enable')} primary />}{canDisable && <ActionButton label={t('plugins.disable')} onClick={() => onAction('disable')} />}{canUnload && <ActionButton label={t('plugins.unload')} onClick={() => onAction('unload')} />}</>}</div></article>
}

function ActionButton({ label, onClick, primary = false }: { label: string; onClick: () => void; primary?: boolean }) {
  return <button className={`button compact ${primary ? 'primary' : 'secondary'}`} onClick={onClick}>{label}</button>
}

function LoadingState() {
  const { t } = useTranslation()
  return <div className="loading-state"><LoaderCircle size={18} className="spin" /><span>{t('plugins.loading')}</span></div>
}

function LanguageButton() {
  const { t, i18n: translate } = useTranslation()
  const next = translate.resolvedLanguage === 'en' ? 'zh-CN' : 'en'
  const change = () => {
    storeLanguage(next)
    void translate.changeLanguage(next)
  }
  return <button className="icon-button" title={t('language.switch')} aria-label={t('language.switch')} onClick={change}><Languages size={16} /></button>
}
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty-state"><FileCode2 size={22} /><strong>{title}</strong><span>{body}</span></div> }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

export default App
