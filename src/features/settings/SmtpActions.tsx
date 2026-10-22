import { Button, Input } from 'antd'
import { ArrowUpRight, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 测试收件人与保存按钮：保存按钮的可用性由外层的「测试指纹」决定。 */
export function SmtpActions({ testTo, onTestToChange, onTest, onSave, testing, saving, canSave, disabled }: {
  testTo: string
  onTestToChange: (value: string) => void
  onTest: () => void
  onSave: () => void
  testing: boolean
  saving: boolean
  canSave: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  return <div className="settings-actions">
    <div className="smtp-test">
      <Input value={testTo} aria-label={t('settings.smtp.testPlaceholder')} onChange={(event) => onTestToChange(event.target.value)} placeholder={t('settings.smtp.testPlaceholder')} disabled={disabled} />
      <Button onClick={onTest} disabled={testing || disabled} loading={testing}>{testing ? t('common.sending') : t('settings.smtp.sendTest')}<ArrowUpRight size={14} /></Button>
    </div>
    <Button type="primary" onClick={onSave} disabled={!canSave}>{saving ? t('common.saving') : t('settings.smtp.save')}<Check size={14} /></Button>
  </div>
}
