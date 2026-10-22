import { Avatar, Typography } from 'antd'
import { Network, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { IconButton } from '../components/IconButton'

export function SidebarBrand({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return <div className="brand-row">
    <Link className="brand-link" to="/" onClick={onClose}>
      <Avatar shape="square" size={30} className="brand-mark" icon={<Network size={17} strokeWidth={2.4} />} />
      <div>
        <Typography.Text strong className="brand-name">Plugmesh</Typography.Text>
        <Typography.Text className="brand-caption">{t('brand.caption')}</Typography.Text>
      </div>
      <span className="sr-only">{t('shell.home')}</span>
    </Link>
    <IconButton label={t('shell.closeNav')} onClick={onClose}><X size={17} /></IconButton>
  </div>
}
