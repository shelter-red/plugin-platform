import { useTranslation } from 'react-i18next'
import type { ApiAccessLog, ApiAudit } from '../api'
import type { Notify } from '../components/ToastProvider'
import { downloadCsv } from '../lib/csv'

/** 访问日志与审计日志的 CSV 导出：列名走 i18n，文件带日期后缀。 */
export function useConsoleExports({ accessLogs, audits, notify }: {
  accessLogs: ApiAccessLog[] | null
  audits: ApiAudit[] | null
  notify: Notify
}) {
  const { t } = useTranslation()

  const exportAccessLogs = () => {
    const rows = accessLogs ?? []
    if (rows.length === 0) return notify('info', t('toast.noAccessLogs'))
    downloadCsv(`plugmesh-access-logs-${new Date().toISOString().slice(0, 10)}.csv`, [t('csv.accessLogs.hostname'), t('csv.accessLogs.method'), t('csv.accessLogs.path'), t('csv.accessLogs.status'), t('csv.accessLogs.duration'), t('csv.accessLogs.error'), t('csv.accessLogs.createdAt')], rows.map((log) => [log.hostname, log.method, log.path, log.status, log.duration_ms, log.error, log.created_at]))
    notify('success', t('toast.accessLogsExported', { count: rows.length }))
  }

  const exportAudit = () => {
    const rows = audits ?? []
    if (rows.length === 0) return notify('info', t('toast.noAudit'))
    downloadCsv(`plugmesh-audit-${new Date().toISOString().slice(0, 10)}.csv`, [t('csv.audit.action'), t('csv.audit.detail'), t('csv.audit.actor'), t('csv.audit.actorEmail'), t('csv.audit.createdAt')], rows.map((item) => [item.action, item.detail_json, item.actor_name, item.actor_email, item.created_at]))
    notify('success', t('toast.auditExported', { count: rows.length }))
  }

  return { exportAccessLogs, exportAudit }
}
