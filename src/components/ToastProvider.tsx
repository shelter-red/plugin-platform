import { App } from 'antd'
import { useMemo } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

/** 通知必须显式声明类型，失败路径不允许复用成功样式。 */
export type Notify = (type: ToastType, message: string, description?: string) => void

export function useToast(): Notify {
  const { notification } = App.useApp()
  return useMemo(() => (type: ToastType, message: string, description?: string) => {
    notification[type]({ message, description, placement: 'topRight', duration: 2.6 })
  }, [notification])
}
