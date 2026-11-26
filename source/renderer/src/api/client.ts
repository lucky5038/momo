/** 后端 API 统一封装：所有页面只从这里取数据，不再散落 fetch。
 *  开发态由 Vite 代理 /api → 127.0.0.1:8787；生产态由 app.js 同源提供。
 *
 *  两条失败通道都要认：
 *   1. HTTP 非 2xx（后端 sendJSON 400/403/500）
 *   2. HTTP 200 但 `{ ok: false, error, hint }`（test-conn 等接口就是这种）
 *  统一抛 ApiError，页面只需要 catch 一次。 */

export class ApiError extends Error {
  status: number
  /** 后端给的排障建议（如「账号或密码错误」「防火墙未拦截 1433」），可能为空 */
  hint: string

  constructor(message: string, status: number, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

function pickString(data: unknown, keys: string[]): string {
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    for (const k of keys) {
      if (typeof rec[k] === 'string' && rec[k]) return rec[k] as string
    }
  }
  return ''
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : '无法连接后端服务', 0)
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  const error = pickString(data, ['error', 'message', 'msg'])
  const hint = pickString(data, ['hint'])
  if (!res.ok) throw new ApiError(error || `请求失败（HTTP ${res.status}）`, res.status, hint)

  // 200 + ok:false：业务失败，同样当错误抛，避免"假成功"
  if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
    throw new ApiError(error || '操作未成功', res.status, hint)
  }

  return data as T
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export interface DbConfig {
  server: string
  user: string
  password: string
  database: string
  backupDir: string
}

export interface DbInfo {
  name: string
  state?: string
}

export interface DbListPayload {
  ok?: boolean
  databases: DbInfo[]
  server?: string
  currentDb?: string
}

export interface MetaPayload {
  docs: unknown[]
  srcs: unknown[]
}

export interface RunPayload {
  [key: string]: unknown
}

export const api = {
  // 连接与配置
  config: () => request<DbConfig>('/api/config'),
  saveConfig: (body: Partial<DbConfig>) => post<{ ok?: boolean }>('/api/save-config', body),
  /** dryRun=true 只探活，不写配置、不切主连接池 */
  testConn: (body: Partial<DbConfig> & { dryRun?: boolean }) =>
    post<{ ok?: boolean; error?: string; hint?: string; autoApplied?: boolean }>('/api/test-conn', body),
  databases: (body?: Partial<DbConfig>) => post<DbListPayload>('/api/databases', body),
  switchDb: (database: string) => post<{ ok?: boolean; database?: string; server?: string }>('/api/switch-db', { database }),
  /** 不传 dir：后端弹原生目录选择框 */
  setBackupDir: (dir?: string) =>
    post<{ ok?: boolean; canceled?: boolean; backupDir?: string; error?: string }>('/api/backup-dir', dir ? { dir } : {}),

  // 元数据与字典（泛型由调用方给强类型，避免页面里 `as unknown as`）
  meta: <T = MetaPayload>(body?: unknown) => post<T>('/api/meta', body),

  // 主流程
  run: <T = Record<string, unknown>>(body: RunPayload) => post<T>('/api/run', body),
  clearColumn: <T = Record<string, unknown>>(body: RunPayload) => post<T>('/api/clear-column', body),
}
