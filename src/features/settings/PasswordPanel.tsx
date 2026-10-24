import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from 'antd'
import { KeyRound } from 'lucide-react'
import { changeAdminPassword } from '../../api'
import { Panel } from '../../components/Panel'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

export function PasswordPanel({ onAction }: { onAction: Notify }) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await changeAdminPassword(currentPassword, newPassword, confirmPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      onAction('success', t('settings.password.changed'))
      window.location.assign('/')
    } catch (error) {
      onAction('error', errorMessage(error, 'settings.password.changeFailed'))
    } finally {
      setSaving(false)
    }
  }

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><KeyRound size={18} /></div>
      <div><h2>{t('settings.password.title')}</h2><p>{t('settings.password.description')}</p></div>
    </div>
  }>
    <div className="form-grid">
      <label>{t('settings.password.current')}<Input.Password value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" disabled={saving} /></label>
      <label>{t('settings.password.next')}<Input.Password value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" disabled={saving} /></label>
      <label>{t('settings.password.confirm')}<Input.Password value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={saving} /></label>
    </div>
    <div className="settings-actions">
      <Button type="primary" onClick={() => void save()} loading={saving} disabled={!currentPassword || !newPassword || !confirmPassword}>{t('settings.password.save')}</Button>
    </div>
  </Panel>
}
