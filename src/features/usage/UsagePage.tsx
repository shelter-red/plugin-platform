import type { CloudflareUsage, LocalUsage, PlatformSettings } from '../../api'
import { PlatformUsageSection } from './PlatformUsageSection'
import { CloudflareUsageSection } from './CloudflareUsageSection'
import { UsageBreakdownPanel } from './UsageBreakdownPanel'
import { UsageSourcesPanel } from './UsageSourcesPanel'
import { UsageStatusAlert } from './UsageStatusAlert'

export function UsagePage({ settings, usage, localUsage, loading, error, onOpenCloudflareSettings }: {
  settings: PlatformSettings | null
  usage: CloudflareUsage | null
  localUsage: LocalUsage | null
  loading: boolean
  error: string | null
  onOpenCloudflareSettings: () => void
}) {
  return <div className="stack">
    <UsageStatusAlert usage={usage} loading={loading} error={error} onOpenCloudflareSettings={onOpenCloudflareSettings} />
    <PlatformUsageSection settings={settings} localUsage={localUsage} />
    <CloudflareUsageSection usage={usage} />
    <UsageSourcesPanel usage={usage} localUsage={localUsage} onOpenCloudflareSettings={onOpenCloudflareSettings} />
    <UsageBreakdownPanel localUsage={localUsage} />
  </div>
}
