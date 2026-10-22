import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowUpRight, Check, Copy, LockKeyhole, X } from 'lucide-react'
import { Select } from 'antd'
import type { ApiPlugin } from '../api'
import { errorMessage, translateError } from '../errors'
import { formatDateTime } from '../lib/format'
import { IconButton } from './IconButton'

export type ModalInput = { prefix?: string; pluginInstanceId?: string }
export type ModalResult = { kind: 'registration'; code: string; expiresAt: string } | { kind: 'plugin'; state: string } | { kind: 'domain'; hostname: string }

export function ProvisionModal({ type, plugins, onClose, onConfirm }: { type: 'server' | 'domain' | 'plugin'; plugins: ApiPlugin[]; onClose: () => void; onConfirm: (input: ModalInput) => Promise<ModalResult> }) {
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

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}><div className="modal" role="dialog" aria-modal="true" aria-label={content.title}><div className="modal-head"><div><h2>{content.title}</h2><p>{content.description}</p></div><IconButton label={t('modal.close')} onClick={onClose}><X size={17} /></IconButton></div>{result?.kind === 'registration' && <div className="code-callout"><span>{t('modal.codeExpires', { time: formatDateTime(result.expiresAt) })}</span><div className="code-value"><strong>{result.code}</strong><button className="row-action" onClick={() => void copyCode(result.code)} aria-label={t('modal.copyCode')} title={t('modal.copyCode')}><Copy size={15} /></button></div></div>}{result?.kind === 'plugin' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>{t('modal.loadConfirmed')}</h3><p>{t('modal.loadConfirmedState', { state: result.state })}</p></div>}{result?.kind === 'domain' && <div className="empty-panel"><div className="empty-illustration"><Check size={22} /></div><h3>{t('modal.domainAssigned')}</h3><p>{result.hostname}</p></div>}{!result && type === 'server' && <div className="empty-panel"><div className="empty-illustration"><LockKeyhole size={22} /></div><h3>{t('modal.generateCode')}</h3><p>{t('modal.codeHint')}</p></div>}{!result && type !== 'server' && <>{candidates.length > 0 ? <label className="modal-field">{t('modal.pluginInstance')}<Select autoFocus aria-label={t('modal.pluginInstance')} value={selectedPluginId || undefined} onChange={setSelectedPluginId} placeholder={t('modal.selectPlugin')} options={candidates.map((plugin) => ({ value: plugin.id, label: `${plugin.name} · ${plugin.plugin_id} · ${plugin.server_name}` }))} showSearch optionFilterProp="label" style={{ width: '100%' }} /></label> : <div className="empty-panel"><div className="empty-illustration"><AlertCircle size={22} /></div><h3>{type === 'plugin' ? t('modal.noLoadable') : t('modal.noAssignable')}</h3><p>{type === 'plugin' ? t('modal.noLoadableHint') : t('modal.noAssignableHint')}</p></div>}{type === 'domain' && candidates.length > 0 && <label className="modal-field">{t('modal.prefix')}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={t('modal.prefixPlaceholder')} maxLength={48} /><span className="field-hint">{t('modal.prefixHint')}</span></label>}</>}{error && <div className="inline-error"><AlertCircle size={14} />{translateError(error)}</div>}<div className="modal-actions"><button className="button secondary" onClick={onClose} disabled={submitting}>{t('modal.closeAction')}</button>{!result && <button className="button primary" onClick={() => void submit()} disabled={submitting || (type !== 'server' && (!selectedPluginId || candidates.length === 0))}>{submitting ? t('common.submitting') : type === 'server' ? t('modal.submitServer') : type === 'domain' ? t('modal.submitDomain') : t('modal.submitPlugin')}<ArrowUpRight size={14} /></button>}</div></div></div>
}
