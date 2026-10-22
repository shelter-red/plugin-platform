import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle, Check, RefreshCw, ShieldCheck, X, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ApiAccessLog, ApiPlugin, ApiPluginDetail, ApiServerDetail, PluginAction } from '../api'
import { translateError } from '../errors'
import { formatDateTime } from '../lib/format'
import { IconButton } from './IconButton'
import { StatusBadge } from './StatusBadge'

export function DetailModal({ detail, data, loading, error, healthLoading, actionLoading, onClose, onOpenPlugin, onHealth, onAction }: { detail: { kind: 'server' | 'plugin'; id: string }; data: { kind: 'server'; value: ApiServerDetail } | { kind: 'plugin'; value: ApiPluginDetail } | null; loading: boolean; error: string | null; healthLoading: boolean; actionLoading: Exclude<PluginAction, 'health'> | null; onClose: () => void; onOpenPlugin: (id: string) => void; onHealth: (plugin: { id: string; name: string }) => void; onAction: (plugin: ApiPlugin, action: Exclude<PluginAction, 'health'>) => void }) {
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
  const actionButton = (action: Exclude<PluginAction, 'health'>, label: string, icon: ReactNode, tone = 'secondary') => <button className={`button ${tone} small`} onClick={() => onAction(plugin, action)} disabled={actionLoading !== null || healthLoading}>{actionLoading === action ? <RefreshCw size={13} className="spin" /> : icon}{actionLoading === action ? t('common.processing') : label}</button>
  return <div className="detail-content"><div className="detail-title-row"><div><strong>{plugin.name}</strong><span>{plugin.plugin_id} · v{plugin.version}</span></div><div className="detail-title-actions">{plugin.state === 'enabled' && <button className="button secondary small" onClick={() => onHealth(plugin)} disabled={healthLoading || actionLoading !== null}>{healthLoading ? <><RefreshCw size={13} className="spin" />{t('pluginCommands.checking')}</> : <><Activity size={13} />{t('pluginCommands.healthCheck')}</>}</button>}{plugin.state === 'discovered' || plugin.state === 'unloaded' || plugin.state === 'failed' ? actionButton('load', t('pluginCommands.load'), <Zap size={13} />, 'primary') : null}{plugin.state === 'loaded' ? actionButton('enable', t('pluginCommands.enable'), <Check size={13} />, 'primary') : null}{plugin.state === 'disabled' ? actionButton('enable', t('pluginCommands.enable'), <Check size={13} />, 'primary') : null}{['loaded', 'enabled', 'disabled'].includes(plugin.state) ? actionButton('unload', t('pluginCommands.unload'), <X size={13} />) : null}{['loaded', 'enabled', 'disabled'].includes(plugin.state) ? actionButton('reload', t('pluginCommands.reload'), <RefreshCw size={13} />) : null}{plugin.state === 'enabled' ? actionButton('disable', t('pluginCommands.disable'), <ShieldCheck size={13} />) : null}<StatusBadge tone={plugin.state === 'enabled' ? 'success' : plugin.state === 'failed' ? 'danger' : 'neutral'}>{t(`status.${plugin.state}`, { defaultValue: plugin.state })}</StatusBadge></div></div><div className="detail-grid"><DetailValue label={t('detail.plugin.server')} value={t('detail.plugin.serverValue', { name: plugin.server_name, status: t(`status.${plugin.server_status}`, { defaultValue: plugin.server_status }) })} /><DetailValue label={t('detail.plugin.desiredState')} value={t(`status.${plugin.desired_state}`, { defaultValue: plugin.desired_state })} /><DetailValue label={t('detail.plugin.domain')} value={plugin.domain_hostname ?? t('common.notAssigned')} /><DetailValue label={t('detail.plugin.recentErrors')} value={String(recentErrors.length)} /></div><DetailSection title={t('detail.plugin.manifest')}><pre className="manifest-block">{manifest}</pre></DetailSection><DetailSection title={t('detail.plugin.recentErrors')}>{recentErrors.length === 0 ? <DetailEmpty text={t('detail.plugin.noErrors')} /> : <ErrorList errors={recentErrors} />}</DetailSection></div>
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section> }
function DetailValue({ label, value }: { label: string; value: string }) { return <div className="detail-value"><span>{label}</span><strong>{value}</strong></div> }
function DetailEmpty({ text }: { text: string }) { return <div className="detail-empty">{text}</div> }
function ErrorList({ errors }: { errors: ApiAccessLog[] }) {
  const { t } = useTranslation()
  return <div className="detail-errors">{errors.map((error) => <div className="detail-error" key={error.id}><div><strong>{error.status} · {error.method}</strong><span>{error.hostname}{error.path}</span></div><time>{formatDateTime(error.created_at)}</time><small>{error.error || t('detail.requestFailed')}</small></div>)}</div>
}
