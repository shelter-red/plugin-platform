import { Cloud, FileText, KeyRound, ShieldCheck, Users } from 'lucide-react'

/** 设置页分区顺序：导航、锚点 id 与滚动高亮共用这一份。 */
export const settingsSections: { id: string; labelKey: string; icon: typeof Cloud }[] = [
  { id: 'cloudflare', labelKey: 'settings.nav.cloudflare', icon: Cloud },
  { id: 'oauth', labelKey: 'settings.nav.oauth', icon: KeyRound },
  { id: 'invites', labelKey: 'settings.nav.invites', icon: Users },
  { id: 'smtp', labelKey: 'settings.nav.smtp', icon: FileText },
  { id: 'maintenance', labelKey: 'settings.nav.maintenance', icon: ShieldCheck },
]
