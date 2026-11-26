/** 触发器管理（P4）：契约来自 app.js 的 trigList / trigToggle / trigDrop。
 *  - 列表：GET /api/triggers → { triggers[], database, server }
 *  - 启停：POST /api/triggers/toggle { trgName, enable }
 *  - 删除：POST /api/triggers/drop { trgName, confirm:true }（后端会先整库备份）
 *  系统默认触发器（SQL 里不是 `UPDATE b SET b.`）后端一律 403 只读，前端只展示不操作。 */
import { post, request } from './client'

export interface TriggerRow {
  name: string
  tbl: string
  disabled: boolean
  desc: string
  isTool: boolean
  targetColumns: string[]
  fieldCount: number
}

export interface TriggerListPayload {
  triggers: TriggerRow[]
  database: string
  server: string
}

export const listTriggers = () => request<TriggerListPayload>('/api/triggers')

export const toggleTrigger = (trgName: string, enable: boolean) =>
  post<{ ok: boolean; enabled: boolean }>('/api/triggers/toggle', { trgName, enable })

export const dropTrigger = (trgName: string) =>
  post<{ ok: boolean; backupPath: string; backupOk: boolean; removedOldBackups?: number }>(
    '/api/triggers/drop',
    { trgName, confirm: true },
  )
