import type { TFunction } from 'i18next'
import type { ApiAccessLog, ApiAudit, ApiDomain, ApiPlugin, ApiServer } from '../api'
import type { CommandItem } from '../components/CommandPalette'
import { settingsSections } from '../features/settings/settings-sections'
import { auditActionLabel } from '../lib/audit'
import type { Page } from './routes'
import { sidebarNavGroups } from './Sidebar'

/** 命令面板条目：导航 + 设置分区 + 当前工作区的服务器/插件/域名/日志/审计。 */
export function buildCommandItems({ t, servers, plugins, domains, accessLogs, audits, onSelectPage, onOpenSettings }: {
  t: TFunction
  servers: ApiServer[] | null
  plugins: ApiPlugin[] | null
  domains: ApiDomain[] | null
  accessLogs: ApiAccessLog[] | null
  audits: ApiAudit[] | null
  onSelectPage: (page: Page) => void
  onOpenSettings: (section: string) => void
}): CommandItem[] {
  const items: CommandItem[] = []
  for (const group of sidebarNavGroups) {
    for (const { id } of group.items) {
      items.push({ id: `page:${id}`, group: t('palette.group.pages'), label: t(`nav.${id}`), run: () => onSelectPage(id) })
    }
  }
  for (const { id, labelKey } of settingsSections) {
    items.push({ id: `settings:${id}`, group: t('palette.group.settings'), label: t(labelKey), run: () => onOpenSettings(id) })
  }
  for (const server of servers ?? []) {
    items.push({ id: `server:${server.id}`, group: t('nav.servers'), label: server.name, hint: t(`status.${server.status}`, { defaultValue: server.status }), run: () => onSelectPage('servers') })
  }
  for (const plugin of plugins ?? []) {
    items.push({ id: `plugin:${plugin.id}`, group: t('nav.plugins'), label: plugin.name, hint: `${plugin.plugin_id} · ${plugin.server_name}`, run: () => onSelectPage('plugins') })
  }
  for (const domain of domains ?? []) {
    items.push({ id: `domain:${domain.id}`, group: t('nav.domains'), label: domain.hostname, hint: domain.plugin_name, run: () => onSelectPage('domains') })
  }
  for (const log of (accessLogs ?? []).slice(0, 30)) {
    items.push({ id: `log:${log.id}`, group: t('nav.logs'), label: `${log.hostname}${log.path}`, hint: `${log.method} · ${log.status}`, run: () => onSelectPage('logs') })
  }
  for (const audit of (audits ?? []).slice(0, 30)) {
    items.push({ id: `audit:${audit.id}`, group: t('nav.audit'), label: auditActionLabel(audit.action), hint: audit.actor_name ?? t('audit.systemEvent'), run: () => onSelectPage('audit') })
  }
  return items
}
