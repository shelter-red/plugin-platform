import { theme, type ThemeConfig } from 'antd'

export type AppThemeMode = 'dark' | 'light'

export const brandColor = { dark: '#10b981', light: '#059669' } as const

/**
 * Ant Design 主题令牌：颜色与字体只在这里定义，页面样式不再写死明暗色值。
 * 原生控件（select/option、日期、颜色输入）一律使用 AntD 组件，跟随算法切换。
 */
export function createAppTheme(mode: AppThemeMode): ThemeConfig {
  const dark = mode === 'dark'
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: brandColor[mode],
      colorInfo: brandColor[mode],
      colorBgBase: dark ? '#09090b' : '#f7f7f8',
      colorBgContainer: dark ? '#111113' : '#ffffff',
      colorBgElevated: dark ? '#151517' : '#ffffff',
      colorBorder: dark ? 'rgba(255,255,255,.12)' : 'rgba(24,24,27,.12)',
      colorBorderSecondary: dark ? 'rgba(255,255,255,.08)' : 'rgba(24,24,27,.08)',
      borderRadius: 6,
      fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
      fontFamilyCode: "'IBM Plex Mono', ui-monospace, monospace",
      fontSize: 12,
    },
    components: {
      Layout: { bodyBg: 'transparent', headerBg: 'transparent', siderBg: 'transparent' },
      Menu: { itemBg: 'transparent', itemHeight: 34, itemBorderRadius: 6, itemMarginInline: 0, subMenuItemBg: 'transparent' },
      Select: { optionSelectedBg: dark ? 'rgba(16,185,129,.16)' : 'rgba(5,150,105,.12)' },
      Table: { headerBg: 'transparent' },
      // 主按钮实心背景统一用可满足 4.5:1 对比度的深绿，与 --primary-solid 保持一致。
      Button: { colorPrimary: '#047857', colorPrimaryHover: '#065f46', colorPrimaryActive: '#064e3b' },
    },
  }
}
