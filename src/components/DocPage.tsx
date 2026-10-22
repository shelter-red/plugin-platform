import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import helpEn from '../content/help.en.md?raw'
import helpZh from '../content/help.zh-CN.md?raw'
import privacyEn from '../content/privacy.en.md?raw'
import privacyZh from '../content/privacy.zh-CN.md?raw'
import termsEn from '../content/terms.en.md?raw'
import termsZh from '../content/terms.zh-CN.md?raw'
import type { DocPage as DocPageId } from '../app/routes'

const documents: Record<'help' | 'terms' | 'privacy', { 'zh-CN': string; en: string }> = {
  help: { 'zh-CN': helpZh, en: helpEn },
  terms: { 'zh-CN': termsZh, en: termsEn },
  privacy: { 'zh-CN': privacyZh, en: privacyEn },
}

const related: DocPageId[] = ['help', 'terms', 'privacy']

export function DocPage({ page }: { page: 'help' | 'terms' | 'privacy' }) {
  const { t, i18n } = useTranslation()
  const content = documents[page][i18n.resolvedLanguage === 'en' ? 'en' : 'zh-CN']
  return <article className="doc-page" aria-label={t(`docs.${page}.title`)}>
    <Markdown>{content}</Markdown>
    <nav className="doc-links" aria-label={t('docs.related')}>
      {related.filter((item) => item !== page).map((item) => <Link key={item} to={`/${item}`}>{t(`docs.${item}.title`)}</Link>)}
    </nav>
  </article>
}
