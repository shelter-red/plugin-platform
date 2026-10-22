import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Panel } from '../../components/Panel'

export function AccountLinksCard() {
  const { t } = useTranslation()
  return <Panel className="account-links" padded>
    <h2>{t('account.more')}</h2>
    <Link to="/help">{t('docs.help.title')}<ArrowUpRight size={14} /></Link>
    <Link to="/terms">{t('docs.terms.title')}<ArrowUpRight size={14} /></Link>
    <Link to="/privacy">{t('docs.privacy.title')}<ArrowUpRight size={14} /></Link>
  </Panel>
}
