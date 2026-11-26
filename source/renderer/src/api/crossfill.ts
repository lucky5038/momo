/** 跨表带值 API 契约：字段与后端 app.js（handleMeta / handleRun / handleClearColumn）对齐。
 *  与 client.ts 的区别：这里给出 meta / run / clear-column 的强类型，页面不再随手 as。 */
import { api } from './client'

export interface ColInfo {
  col: string
  maxLen?: number
  desc?: string
  custom?: boolean
}

export interface MetaDoc {
  id: string
  name: string
  main: string
  mainKeyCol: string
  sub: string
  keyCol: string
  refCol?: string
  info?: boolean
  party?: 'supplier' | 'customer' | 'none'
  partyCol?: string
  prefCol?: string
  seqCol?: string
  colNo?: string
  colSeq?: string
}

export interface MetaSrc {
  id: string
  name: string
  info?: boolean
  party?: 'supplier' | 'customer' | 'item'
  key?: string[]
  keyDesc?: string
  seqKey?: string
  shape?: string
}

export interface Meta {
  docs: MetaDoc[]
  srcs: MetaSrc[]
  srcAllCols: Record<string, ColInfo[]>
  tgtAllCols: Record<string, ColInfo[]>
  srcExcluded: Record<string, string[]>
  currentDb?: string
  server?: string
  user?: string
}

export interface RunRequest {
  docId: string
  tgtCol: string
  srcId: string
  srcValCol: string
  partyKey: number
  mode: 'fill'
  confirm: boolean
  force: boolean
  chain: null
  createTrigger: boolean
  forceCreateTrigger: boolean
  mergeDisplay: boolean
  triggerTimeMode: 'none'
  mappings: []
}

export interface PreviewRow {
  单号?: string
  序号?: string
  现值?: string
  应带?: string
  [k: string]: string | undefined
}

export interface PreviewResponse {
  preview: true
  mappingCount?: number
  totalRows?: number
  sample?: PreviewRow[]
  partyNote?: string | null
  joins?: unknown[]
  channelNote?: string | null
  chainNote?: string | null
  typeWarning?: string | null
  chainWarning?: string | null
  mergeNote?: string | null
  note?: string | null
}

export interface TriggerResult {
  ok?: boolean
  name?: string
  skipped?: boolean
  allowForce?: boolean
  conflict?: string[]
  conflictNote?: string | null
  error?: string | null
  mergedExisting?: number
  removedDuplicates?: number
}

export interface RunResponse {
  ok?: true
  mappingCount?: number
  affected?: number
  cleared?: number
  backupPath?: string
  backupOk?: boolean
  removedOldBackups?: number
  /** 后端在成功响应里回传本次执行的 SQL，便于排查 */
  updateSql?: string
  updateSqls?: string[]
  sampleAfter?: { docNo?: string; filled?: string }[]
  triggerResult?: TriggerResult
}

export interface ClearResponse {
  ok?: boolean
  preview?: boolean
  /** 预览阶段回传的单据名、子表名与列名（旧界面用来提示"清哪个表的哪一列"） */
  doc?: string
  table?: string
  column?: string
  count?: number
  affected?: number
  message?: string
  backupPath?: string
  backupOk?: boolean
}

/** 目标列只允许 960–995 后缀（与后端 isCustomColumn 完全一致）。 */
export function isCustomColumn(col: string): boolean {
  const m = String(col || '').trim().match(/^([A-Za-z][A-Za-z0-9_]*?)(\d{3})$/)
  if (!m) return false
  const n = Number(m[2])
  return n >= 960 && n <= 995
}

export const fetchMeta = () => api.meta<Meta>()
export const runFill = <T extends PreviewResponse | RunResponse>(body: RunRequest) => api.run<T>(body as unknown as Record<string, unknown>)
export const clearColumn = (body: { docId: string; tgtCol: string; confirm: boolean }) =>
  api.clearColumn<ClearResponse>(body as unknown as Record<string, unknown>)
