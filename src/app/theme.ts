import { createTheme } from '@mui/material/styles'

export type AppThemeMode = 'dark' | 'light'
export type ThemePreference = AppThemeMode | 'system'

export const brandColor = { dark: '#62d6ad', light: '#087a63' } as const

export function createAppTheme(mode: AppThemeMode) {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: brandColor[mode] },
      secondary: { main: dark ? '#f4bd6a' : '#a66118' },
      background: { default: dark ? '#111a19' : '#f4f7f5', paper: dark ? '#192321' : '#ffffff' },
      divider: dark ? 'rgba(220,246,235,.12)' : 'rgba(20,59,48,.14)',
      success: { main: dark ? '#5bc49b' : '#237a4c' },
      warning: { main: dark ? '#f3bc67' : '#a55a12' },
      error: { main: dark ? '#f07f78' : '#b43f35' },
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: "'DM Sans', 'Noto Sans CJK SC', system-ui, sans-serif",
      fontSize: 15,
      h1: { fontSize: '2rem', fontWeight: 700 },
      h2: { fontSize: '1.65rem', fontWeight: 700 },
      h3: { fontSize: '1.35rem', fontWeight: 700 },
      h4: { fontSize: '1.15rem', fontWeight: 700 },
      body1: { fontSize: '0.95rem', lineHeight: 1.55 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { minWidth: 320, backgroundColor: dark ? '#111a19' : '#f4f7f5' } } },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 6, minHeight: 38 } } },
      MuiCard: { styleOverrides: { root: { borderRadius: 7, backgroundImage: 'none' } } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 700 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 8, backgroundImage: 'none' } } },
    },
  })
}
