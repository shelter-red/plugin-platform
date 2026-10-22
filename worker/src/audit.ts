import type { Env } from './types'

/** 审计记录同时保留工作区与操作者；平台级事件的工作区可以为空。 */
export async function recordAudit(env: Env, workspaceId: string | null, userId: string | null, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), workspaceId, userId, action, JSON.stringify(detail), new Date().toISOString()).run()
}
