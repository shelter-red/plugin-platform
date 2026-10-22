import { Button } from 'antd'
import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function AccountLogoutButton() {
  const { t } = useTranslation()
  return <Button className="account-logout" onClick={() => window.location.assign('/auth/logout')} icon={<LogOut size={15} />}>{t('account.logout')}</Button>
}
