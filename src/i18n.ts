import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import zhCN from './locales/zh-CN'

export type Language = 'zh-CN' | 'en'

const LANGUAGE_STORAGE_KEY = 'plugmesh-language'

function readStoredLanguage(): Language {
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'
}

export function storeLanguage(language: Language): void {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng: readStoredLanguage(),
  fallbackLng: 'zh-CN',
  initAsync: false,
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})
document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN'

export default i18n
