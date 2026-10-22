import { Button, Input, Space } from 'antd'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from './ToastProvider'

/** 固定值字段：必须可见、只读、可复制，并在字段下方说明用途。 */
export function CopyField({ label, value, hint, ariaLabel }: { label: string; value: string; hint?: string; ariaLabel?: string }) {
  const { t } = useTranslation()
  const notify = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      notify('success', t('common.copied'))
    } catch {
      notify('error', t('common.copyFailed'))
    }
  }
  return <div className="field">
    <span className="field-label">{label}</span>
    <Space.Compact block>
      <Input readOnly value={value} aria-label={ariaLabel ?? label} />
      <Button icon={<Copy size={14} />} onClick={() => void copy()} aria-label={t('common.copyValue', { label })}>{t('common.copy')}</Button>
    </Space.Compact>
    {hint && <span className="field-hint">{hint}</span>}
  </div>
}
