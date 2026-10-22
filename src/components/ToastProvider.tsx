import { App } from 'antd'
import { useMemo } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** 通知必须显式声明类型，失败路径不允许复用成功样式。 */
export type Notify = (type: ToastType, message: string, description?: string) => void

export function useToast(): Notify {
  const { notification } = App.useApp()
  return useMemo(() => (type: ToastType, message: string, description?: string) => {
    // 右上角是每个页面主操作的固定位置（刷新状态/刷新用量/保存配置都排在右上），提示
    // 停在那里会盖住按钮：悬停又会暂停自动关闭计时，按钮就点不到。改在右下角显示，
    // 页面操作区始终可点，提示本身的可读时间不变。
    notification[type]({ message, description, placement: 'bottomRight', duration: 2.6 })
  }, [notification])
}
