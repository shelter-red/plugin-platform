import { useTranslation } from 'react-i18next'
import { Activity, Code2, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
import type { ApiPlugin } from '../../api'
import i18n from '../../i18n'
import { StatusBadge } from '../../components/StatusBadge'

export function capabilityLabel(plugin: ApiPlugin): string {
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

export function PluginsPage({ plugins, loading, onSync, onLoad, onDetail, onHealth }: { plugins: ApiPlugin[]; loading: boolean; onSync: () => void; onLoad: () => void; onDetail: (id: string) => void; onHealth: (plugin: ApiPlugin) => void }) {
  const { t } = useTranslation()
  const enabled = plugins.filter((plugin) => plugin.state === 'enabled').length
  return <div className="stack"><div className="filter-row"><div className="filter-summary"><span className="filter-dot" />{t('plugins.enabled', { count: enabled })} <span className="divider" />{t('plugins.discovered', { count: plugins.length })}</div><button className="button secondary small" onClick={onSync} disabled={loading}><RefreshCw size={14} />{t('plugins.sync')}</button></div>{plugins.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Code2 size={22} /></div><h3>{t('plugins.emptyTitle')}</h3><p>{t('plugins.emptyBody')}</p><button className="button primary" onClick={onLoad}><Plus size={15} />{t('plugins.load')}</button></div> : <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>{t('plugins.columnPlugin')}</th><th>{t('plugins.columnServer')}</th><th>{t('plugins.columnState')}</th><th>{t('plugins.columnCapability')}</th><th>{t('plugins.columnDomain')}</th><th /></tr></thead><tbody>{plugins.map((plugin) => <tr key={plugin.id}><td><div className="cell-title"><div className="table-icon"><Code2 size={15} /></div><div><strong>{plugin.name}</strong><small>{plugin.plugin_id} · v{plugin.version}</small></div></div></td><td>{plugin.server_name}</td><td><StatusBadge tone={plugin.state === 'enabled' ? 'success' : plugin.state === 'failed' ? 'danger' : 'neutral'}>{t(`status.${plugin.state}`, { defaultValue: plugin.state })}</StatusBadge></td><td><span className="capability">{capabilityLabel(plugin)}</span></td><td>{plugin.domain_hostname ? <a href={`https://${plugin.domain_hostname}`} target="_blank" rel="noreferrer">{plugin.domain_hostname}</a> : <span className="muted">{t('common.notAssigned')}</span>}</td><td className="row-actions"><>{plugin.state === 'enabled' && <button className="row-action" onClick={() => onHealth(plugin)} aria-label={t('plugins.health', { name: plugin.name })} title={t('plugins.healthTitle')}><Activity size={16} /></button>}<button className="row-action" onClick={() => onDetail(plugin.id)} aria-label={t('plugins.view', { name: plugin.name })} title={t('plugins.viewTitle')}><MoreHorizontal size={17} /></button></></td></tr>)}</tbody></table></div><div className="table-footer"><span>{t('plugins.footer', { count: plugins.length })}</span><button className="text-link" onClick={onLoad}>{t('plugins.load')} <Plus size={14} /> </button></div></div>}</div>
}
