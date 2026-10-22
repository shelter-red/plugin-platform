export type Page = 'overview' | 'servers' | 'plugins' | 'domains' | 'usage' | 'logs' | 'audit' | 'settings'
export type DocPage = 'help' | 'terms' | 'privacy' | 'account'

export const PAGE_PATHS: Record<Page, string> = {
  overview: '/',
  servers: '/servers',
  plugins: '/plugins',
  domains: '/domains',
  usage: '/usage',
  logs: '/logs',
  audit: '/audit',
  settings: '/settings',
}

const DOC_PATHS: DocPage[] = ['help', 'terms', 'privacy', 'account']

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function pageFromPath(pathname: string): Page | null {
  const path = normalizePath(pathname)
  return (Object.entries(PAGE_PATHS) as [Page, string][]).find(([, value]) => value === path)?.[0] ?? null
}

export function docFromPath(pathname: string): DocPage | null {
  const path = normalizePath(pathname)
  return DOC_PATHS.find((doc) => `/${doc}` === path) ?? null
}
