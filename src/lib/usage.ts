export function usagePercent(current: number | null | undefined, limit: number | null | undefined): number {
  if (current == null || limit == null || !Number.isFinite(current) || !Number.isFinite(limit) || current < 0 || limit <= 0) return 0
  return Math.min(100, (current / limit) * 100)
}
