import type { ReactNode } from 'react'

// 用量分组：平台本地统计与 Cloudflare 免费额度分开呈现，避免把平台计数误读成官方额度。
export function UsageSection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section className="usage-section">
    <div className="usage-section-head"><h2>{title}</h2><p>{hint}</p></div>
    <div className="usage-grid">{children}</div>
  </section>
}
