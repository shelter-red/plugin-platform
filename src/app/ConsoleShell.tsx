import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { App, Drawer } from 'antd'
import { CircleHelp, LogOut, UserRound } from 'lucide-react'
import { type AppThemeMode, type ThemePreference } from '../app/theme'
import { useToast } from '../components/ToastProvider'
import { errorMessage } from '../errors'
import { DetailModal } from '../components/DetailModal'
import { ProvisionModal, type ModalInput, type ModalResult } from '../components/ProvisionModal'
import { CommandPalette, type CommandItem } from '../components/CommandPalette'
import { DocPage } from '../components/DocPage'
import { AccountPage } from '../features/account/AccountPage'
import { PAGE_PATHS, docFromPath, pageFromPath, type Page } from '../app/routes'
import { storeLanguage, type Language } from '../i18n'
import { WorkspacePage } from '../features/workspaces/WorkspacePage'
import { OverviewPage } from '../features/overview/OverviewPage'
import { ServersPage } from '../features/servers/ServersPage'
import { PluginsPage } from '../features/plugins/PluginsPage'
import { DomainsPage } from '../features/domains/DomainsPage'
import { UsagePage } from '../features/usage/UsagePage'
import { AccessLogsPage } from '../features/logs/AccessLogsPage'
import { AuditPage } from '../features/audit/AuditPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { settingsSections } from '../features/settings/settings-sections'
import { Sidebar, sidebarNavGroups } from './Sidebar'
import { useConsoleData } from './useConsoleData'
import { Topbar } from './Topbar'
import { PageHeader } from './PageHeader'
import { auditActionLabel } from '../lib/audit'
import { downloadCsv } from '../lib/csv'
import { useMediaQuery } from '../lib/useMediaQuery'
import { AuthLoadingScreen, LoginPage } from '../features/auth/AuthScreen'
import { assignDomain, checkPluginHealth, commandPlugin, createRegistrationCode, fetchPluginDetails, fetchServerDetails, syncServer, type ApiPlugin, type ApiPluginDetail, type ApiServerDetail, type PluginAction, type PluginHealthResult } from '../api'

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

  const changeLanguage = (next: Language) => {
    storeLanguage(next)
    void translator.changeLanguage(next)
  }

  const notify = useToast()
  const openSettingsSection = (section: string) => {
    navigate(PAGE_PATHS.settings)
    setSidebarOpen(false)
    setSettingsFocus({ section, nonce: Date.now() })
  }
  // 数据层与 UI 层分离：拉取与刷新在 useConsoleData，弹窗/详情/命令面板仍由本组件持有。
  const data = useConsoleData({ notify, openSettingsSection })
  const {
    authEnabled, authState, authUser, workspaces, activeWorkspaceId, activeWorkspace, canWrite, isSuperAdmin,
    overview, servers, plugins, domains, audits, accessLogs, invites, setInvites, usage, localUsage,
    dataLoading, dataError, auditLoading, auditError, accessLogsLoading, accessLogsError, usageLoading, usageRefreshing, usageError,
    platformSettings, setPlatformSettings, cloudflareSettings, setCloudflareSettings, smtpSettings, setSmtpSettings, oauthSettings, setOauthSettings,
    cloudflareDiagnosis, setCloudflareDiagnosis, apiLive, range, setRange, refreshData, refreshUsage, reloadWorkspaces,
  } = data

  // 切换工作区时同时收起打开中的弹窗与详情，避免展示上一个工作区对象。
  const switchWorkspace = (workspaceId: string) => {
    data.switchWorkspace(workspaceId)
    setDetail(null)
    setModal(null)
  }

  const meta = page
    ? { title: t(`pages.${page}.title`), description: t(`pages.${page}.description`) }
    : docPage
      ? { title: t(`docs.${docPage}.title`), description: t(`docs.${docPage}.description`) }
      : { title: t('nav.overview'), description: '' }
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

  const paletteItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []
    for (const group of sidebarNavGroups) {
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

  const sidebarProps = {
    compactNav: compactNav && !mobileNav,
    onClose: () => setSidebarOpen(false),
    page,
    serverCount: servers?.length ?? 0,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    apiLive,
    user: authUser,
    userMenuItems,
    onUserMenu,
    onSelectPage: selectPage,
    onSwitchWorkspace: switchWorkspace,
    onManageWorkspaces: () => navigate('/workspaces'),
  }

  if (authEnabled && authState === 'loading') return <AuthLoadingScreen mode={effectiveTheme} />
  if (authEnabled && authState === 'anonymous') return <LoginPage mode={effectiveTheme} />
  if (!page && !docPage) return <Navigate to="/" replace />

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
          <Sidebar {...sidebarProps} compactNav={false} />
        </Drawer>
      ) : <Sidebar {...sidebarProps} />}

      <main className="main-column">
        <Topbar title={meta.title} theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={changeLanguage} userInitials={userInitials} userMenuItems={userMenuItems} onUserMenu={onUserMenu} onOpenPalette={() => setPaletteOpen(true)} onOpenNav={() => setSidebarOpen(true)} onOpenAudit={() => selectPage('audit')} />
        <div className="page-scroll">
          <div className="page-content">
            <PageHeader title={meta.title} description={meta.description} apiLive={apiLive} page={page} canWrite={canWrite} activeWorkspace={activeWorkspace} dataLoading={dataLoading} dataError={dataError} usageRefreshing={usageRefreshing} onRefreshData={() => void refreshData()} onRefreshUsage={() => void refreshUsage()} onOpenProvision={setModal} />
            {page === 'overview' && <OverviewPage overview={overview} usage={usage} localUsage={localUsage} settings={platformSettings} audits={audits ?? []} accessLogs={accessLogs} accessLogsLoading={accessLogsLoading} accessLogsError={accessLogsError} servers={servers ?? []} range={range} setRange={setRange} onNavigate={selectPage} />}
            {page === 'servers' && <ServersPage servers={servers ?? []} loading={dataLoading} onRefresh={() => void refreshData()} onBind={() => setModal('server')} onDetail={(id) => void openDetail('server', id)} />}
            {page === 'plugins' && <PluginsPage plugins={plugins ?? []} loading={dataLoading} onSync={() => void syncManifests()} onLoad={() => setModal('plugin')} onDetail={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} />}
            {page === 'domains' && <DomainsPage domains={domains ?? []} loading={dataLoading} onAction={notify} onRefresh={() => void refreshData()} onAssign={() => setModal('domain')} />}
            {page === 'usage' && <UsagePage settings={platformSettings} usage={usage} localUsage={localUsage} loading={usageLoading} refreshing={usageRefreshing} error={usageError} onRefresh={() => void refreshUsage()} onOpenCloudflareSettings={() => openSettingsSection('cloudflare')} />}
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
