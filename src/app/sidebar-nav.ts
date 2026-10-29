import { Activity, Box, Building2, FileText, Gauge, Globe2, LayoutDashboard, Server, Settings } from 'lucide-react'
import type { Page } from './routes'

export const sidebarNavGroups: { labelKey: string; items: { id: Page; icon: typeof LayoutDashboard }[] }[] = [
  {
    labelKey: 'nav.groups.overview',
    items: [{ id: 'overview', icon: LayoutDashboard }],
  },
  {
    labelKey: 'nav.groups.resources',
    items: [
      { id: 'servers', icon: Server },
      { id: 'plugins', icon: Box },
      { id: 'domains', icon: Globe2 },
      { id: 'workspaces', icon: Building2 },
    ],
  },
  {
    labelKey: 'nav.groups.monitoring',
    items: [
      { id: 'usage', icon: Gauge },
      { id: 'logs', icon: Activity },
      { id: 'audit', icon: FileText },
    ],
  },
  {
    labelKey: 'nav.groups.administration',
    items: [{ id: 'settings', icon: Settings }],
  },
]
