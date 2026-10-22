import { Input } from 'antd'
import { useTranslation } from 'react-i18next'

export function WorkspaceRenameForm({ name, onChange, disabled, placeholder }: { name: string; onChange: (value: string) => void; disabled: boolean; placeholder: string }) {
  const { t } = useTranslation()
  return <div className="form-grid">
    <label>{t('workspace.rename')}<Input value={name} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} /></label>
  </div>
}
