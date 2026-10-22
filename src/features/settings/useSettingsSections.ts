import { useEffect, useState } from 'react'

const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

const scrollToSection = (section: string) => {
  document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}

/**
 * 分区导航状态：点击跳转、外部 focusSection 触发跳转、滚动时反向同步高亮。
 * 分区集合在设置页挂载时即固定，观察器只建一次。
 */
export function useSettingsSections(ids: string[], focusSection: { section: string; nonce: number } | null) {
  const [activeSection, setActiveSection] = useState(ids[0] ?? '')

  const goToSection = (section: string) => {
    setActiveSection(section)
    scrollToSection(section)
  }

  useEffect(() => {
    if (!focusSection) return
    setActiveSection(focusSection.section)
    scrollToSection(focusSection.section)
  }, [focusSection])

  useEffect(() => {
    const scroller = document.querySelector('.page-scroll')
    const sections = ids.map((id) => document.getElementById(`settings-${id}`)).filter((section): section is HTMLElement => section !== null)
    if (!scroller || sections.length === 0) return
    const visible = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const current = sections.find((section) => visible.has(section.id))
      if (current) setActiveSection(current.id.replace('settings-', ''))
    }, { root: scroller, rootMargin: '-72px 0px -55% 0px' })
    sections.forEach((section) => observer.observe(section))
    // 末尾区块通常不足视口高度，滚到底时直接高亮最后一项，避免高亮停在上一节。
    const onScroll = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8) setActiveSection(ids[ids.length - 1])
    }
    scroller.addEventListener('scroll', onScroll)
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [])

  return { activeSection, goToSection }
}
