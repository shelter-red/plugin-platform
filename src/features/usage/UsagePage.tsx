import type { CloudflareUsage, LocalUsage, PlatformSettings } from '../../api'
import { PlatformUsageSection } from './PlatformUsageSection'
import { CloudflareUsageSection } from './CloudflareUsageSection'
import { UsageBreakdownPanel } from './UsageBreakdownPanel'
import { UsageSourcesPanel } from './UsageSourcesPanel'
import { UsageStatusAlert } from './UsageStatusAlert'

export function UsagePage({ settings, usage, localUsage, loading, refreshing, error, onRefresh, onOpenCloudflareSettings }: {
  settings: PlatformSettings | null
  usage: CloudflareUsage | null
  localUsage: LocalUsage | null
  loading: boolean
  refreshing: boolean
  error: string | null
  onRefresh: () => void
  onOpenCloudflareSettings: () => void
}) {
  return <div className="stack">
    <UsageStatusAlert usage={usage} loading={loading} refreshing={refreshing} error={error} onRefresh={onRefresh} onOpenCloudflareSettings={onOpenCloudflareSettings} />
    <PlatformUsageSection settings={settings} localUsage={localUsage} />
    <CloudflareUsageSection settings={settings} usage={usage} />
    <UsageSourcesPanel usage={usage} localUsage={localUsage} refreshing={refreshing} onRefresh={onRefresh} onOpenCloudflareSettings={onOpenCloudflareSettings} />
    <UsageBreakdownPanel localUsage={localUsage} />
  </div>
}
