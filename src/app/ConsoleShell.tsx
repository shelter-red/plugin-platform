import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Drawer } from 'antd'
import { CircleHelp, LogOut, UserRound } from 'lucide-react'
import { type AppThemeMode, type ThemePreference } from '../app/theme'
import { useToast } from '../components/ToastProvider'
import { errorMessage } from '../errors'
import { DetailModal } from '../components/DetailModal'
import { ProvisionModal, type ModalInput, type ModalResult } from '../components/ProvisionModal'
import { CommandPalette } from '../components/CommandPalette'
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
import { Sidebar } from './Sidebar'
import { useConsoleData } from './useConsoleData'
import { useConsoleExports } from './useConsoleExports'
import { usePluginActions } from './usePluginActions'
import { buildCommandItems } from './palette'
import { Topbar } from './Topbar'
import { PageHeader } from './PageHeader'
import { useMediaQuery } from '../lib/useMediaQuery'
import { AuthLoadingScreen } from '../features/auth/AuthLoadingScreen'
import { LoginPage } from '../features/auth/LoginPage'
import { assignDomain, commandPlugin, createRegistrationCode, syncServer } from '../api'

export type ConsoleProps = {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  effectiveTheme: AppThemeMode
  language: Language
}

export function ConsoleShell({ theme, setTheme, effectiveTheme, language }: ConsoleProps) {
  const { t, i18n: translator } = useTranslation()
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
  const data = useConsoleData({ notify })
  const {
    authEnabled, authState, authUser, workspaces, activeWorkspaceId, activeWorkspace, canWrite, isSuperAdmin,
    overview, servers, plugins, domains, audits, accessLogs, invites, setInvites, usage, localUsage,
    dataLoading, dataError, auditLoading, auditError, accessLogsLoading, accessLogsError, usageLoading, usageRefreshing, usageError,
    platformSettings, setPlatformSettings, cloudflareSettings, setCloudflareSettings, smtpSettings, setSmtpSettings, oauthSettings, setOauthSettings,
    apiLive, range, setRange, refreshData, refreshUsage, reloadWorkspaces,
  } = data
  const { detail, detailData, detailLoading, detailError, openDetail, closeDetail, healthPluginId, pluginActionLoading, runHealthCheck, runPluginAction } = usePluginActions({ notify, refreshData })
  const { exportAccessLogs, exportAudit } = useConsoleExports({ accessLogs, audits, notify })

  // 切换工作区时同时收起打开中的弹窗与详情，避免展示上一个工作区对象。
  const switchWorkspace = (workspaceId: string) => {
    data.switchWorkspace(workspaceId)
    closeDetail()
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

  const paletteItems = useMemo(() => buildCommandItems({ t, servers, plugins, domains, accessLogs, audits, onSelectPage: selectPage, onOpenSettings: openSettingsSection }), [accessLogs, audits, domains, plugins, servers, t])
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
            {page === 'servers' && <ServersPage servers={servers ?? []} loading={dataLoading} onRefresh={() => void refreshData()} onDetail={(id) => void openDetail('server', id)} />}
            {page === 'plugins' && <PluginsPage plugins={plugins ?? []} loading={dataLoading} onSync={() => void syncManifests()} onDetail={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} />}
            {page === 'domains' && <DomainsPage domains={domains ?? []} loading={dataLoading} onAction={notify} onRefresh={() => void refreshData()} />}
            {page === 'usage' && <UsagePage settings={platformSettings} usage={usage} localUsage={localUsage} loading={usageLoading} error={usageError} onOpenCloudflareSettings={() => openSettingsSection('cloudflare')} />}
            {page === 'logs' && <AccessLogsPage logs={accessLogs ?? []} loading={accessLogsLoading} error={accessLogsError} onExport={exportAccessLogs} />}
            {page === 'audit' && <AuditPage audits={audits ?? []} loading={auditLoading} error={auditError} onExport={exportAudit} />}
            {page === 'workspaces' && <WorkspacePage workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onSwitch={switchWorkspace} onWorkspacesChange={reloadWorkspaces} onAction={notify} />}
            {page === 'settings' && <SettingsPage focusSection={settingsFocus} settings={platformSettings} apiLive={apiLive} isSuperAdmin={isSuperAdmin} canManageInvites={isSuperAdmin || activeWorkspace?.role === 'owner'} activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} onSettingsChange={setPlatformSettings} cloudflareSettings={cloudflareSettings} onCloudflareChange={setCloudflareSettings} smtpSettings={smtpSettings} onSmtpChange={setSmtpSettings} oauthSettings={oauthSettings} onOauthChange={setOauthSettings} invites={invites} onInvitesChange={setInvites} onAction={notify} />}
            {docPage && (docPage === 'account' ? <AccountPage user={authUser} workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} /> : <DocPage page={docPage} />)}
          </div>
        </div>
      </main>
      {modal && <ProvisionModal type={modal} plugins={plugins ?? []} onClose={() => setModal(null)} onConfirm={(input) => confirmModal(modal, input)} />}
      {detail && <DetailModal detail={detail} data={detailData} loading={detailLoading} error={detailError} healthLoading={healthPluginId === detail.id} actionLoading={pluginActionLoading?.id === detail.id ? pluginActionLoading.action : null} onClose={closeDetail} onOpenPlugin={(id) => void openDetail('plugin', id)} onHealth={(plugin) => void runHealthCheck(plugin)} onAction={(plugin, action) => void runPluginAction(plugin, action)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} items={paletteItems} />}
    </div>
  )
}
