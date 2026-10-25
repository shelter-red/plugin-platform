import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Input, Modal, Result, Select, Typography } from 'antd'
import { AlertCircle, Copy, LockKeyhole } from 'lucide-react'
import type { ApiPlugin } from '../api'
import { errorMessage, translateError } from '../errors'
import { formatDateTime } from '../lib/format'

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

  return (
    <Modal
      open
      className="provision-modal"
      width={560}
      maskClosable={!submitting}
      keyboard={!submitting}
      onCancel={onClose}
      destroyOnHidden
      title={<div className="modal-head"><div><h2>{content.title}</h2><p>{content.description}</p></div></div>}
      footer={<div className="modal-actions">
        <Button onClick={onClose} disabled={submitting}>{t('modal.closeAction')}</Button>
        {!result && <Button type="primary" onClick={() => void submit()} loading={submitting} disabled={type !== 'server' && (!selectedPluginId || candidates.length === 0)}>{submitting ? t('common.submitting') : type === 'server' ? t('modal.submitServer') : type === 'domain' ? t('modal.submitDomain') : t('modal.submitPlugin')}</Button>}
      </div>}
    >
      {result?.kind === 'registration' && <div className="code-callout">
        <span>{t('modal.codeExpires', { time: formatDateTime(result.expiresAt) })}</span>
        <div className="code-value">
          <Typography.Text strong>{result.code}</Typography.Text>
        </div>
        <Button size="small" onClick={() => void copyCode(result.code)} aria-label={t('modal.copyCode')} icon={<Copy size={15} />}>{t('modal.copyCode')}</Button>
      </div>}
      {result?.kind === 'plugin' && <Result status="success" title={t('modal.loadConfirmed')} subTitle={t('modal.loadConfirmedState', { state: result.state })} />}
      {result?.kind === 'domain' && <Result status="success" title={t('modal.domainAssigned')} subTitle={result.hostname} />}
      {!result && type === 'server' && <Result icon={<LockKeyhole size={40} />} title={t('modal.generateCode')} subTitle={t('modal.codeHint')} />}
      {!result && type !== 'server' && <>
        {candidates.length > 0
          ? <label className="modal-field">{t('modal.pluginInstance')}<Select autoFocus aria-label={t('modal.pluginInstance')} value={selectedPluginId || undefined} onChange={setSelectedPluginId} placeholder={t('modal.selectPlugin')} options={candidates.map((plugin) => ({ value: plugin.id, label: `${plugin.name} · ${plugin.plugin_id} · ${plugin.server_name}` }))} showSearch optionFilterProp="label" style={{ width: '100%' }} /></label>
          : <Result status="info" icon={<AlertCircle size={40} />} title={type === 'plugin' ? t('modal.noLoadable') : t('modal.noAssignable')} subTitle={type === 'plugin' ? t('modal.noLoadableHint') : t('modal.noAssignableHint')} />}
        {type === 'domain' && candidates.length > 0 && <label className="modal-field">{t('modal.prefix')}<Input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={t('modal.prefixPlaceholder')} maxLength={48} /><span className="field-hint">{t('modal.prefixHint')}</span></label>}
      </>}
      {error && <Alert className="modal-error" type="error" showIcon message={translateError(error)} />}
    </Modal>
  )
}
