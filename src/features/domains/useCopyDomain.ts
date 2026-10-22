import { useTranslation } from 'react-i18next'
import type { Notify } from '../../components/ToastProvider'

export function useCopyDomain(onAction: Notify) {
  const { t } = useTranslation()
  return async (hostname: string) => {
    if (!navigator.clipboard) {
      onAction('warning', t('domains.clipboardUnsupported'))
      return
    }
    try {
      await navigator.clipboard.writeText(hostname)
      onAction('success', t('domains.copied'))
    } catch {
      onAction('error', t('domains.copyFailed'))
    }
  }
}
