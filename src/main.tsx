import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { App as UiApp } from './components/mui-compat'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './styles.css'
import './i18n'
import { createAppTheme, type AppThemeMode, type ThemePreference } from './app/theme'
import { type Language } from './i18n'
import { ConsoleShell } from './app/ConsoleShell'

function Root() {
  const { i18n: translator } = useTranslation()
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const savedTheme = window.localStorage.getItem('plugmesh-theme')
    return savedTheme === 'light' || savedTheme === 'system' ? savedTheme : 'dark'
  })
  const [systemTheme, setSystemTheme] = useState<AppThemeMode>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  const language: Language = translator.resolvedLanguage === 'en' ? 'en' : 'zh-CN'
  const effectiveTheme: AppThemeMode = theme === 'system' ? systemTheme : theme

  useEffect(() => {
    window.localStorage.setItem('plugmesh-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', effectiveTheme === 'light')
    document.documentElement.style.colorScheme = effectiveTheme
  }, [effectiveTheme])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'light' : 'dark')
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  return <ThemeProvider theme={createAppTheme(effectiveTheme)}><CssBaseline /><UiApp><ConsoleShell theme={theme} setTheme={setTheme} effectiveTheme={effectiveTheme} language={language} /></UiApp></ThemeProvider>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><Root /></BrowserRouter>)
