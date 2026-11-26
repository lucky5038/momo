/** 后端 API 统一封装：所有页面只从这里取数据，不再散落 fetch。
 *  开发态由 Vite 代理 /api → 127.0.0.1:8787；生产态由 app.js 同源提供。 */

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function pickError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    for (const k of ['error', 'message', 'msg']) {
      if (typeof rec[k] === 'string' && rec[k]) return rec[k] as string
    }
  }
  return `请求失败（HTTP ${status}）`
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

  if (!res.ok) throw new ApiError(pickError(data, res.status), res.status)
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
  testConn: (body: Partial<DbConfig>) => post<{ ok?: boolean; error?: string }>('/api/test-conn', body),
  databases: (body?: Partial<DbConfig>) => post<DbInfo[]>('/api/databases', body),
  switchDb: (database: string) => post<{ ok?: boolean }>('/api/switch-db', { database }),
  backupDir: () => request<{ dir?: string }>('/api/backup-dir'),

  // 首次引导
  firstOpen: () => request<Record<string, unknown>>('/api/first-open'),
  onboarding: () => request<Record<string, unknown>>('/api/onboarding'),

  // 元数据与字典
  meta: (body?: unknown) => post<MetaPayload>('/api/meta', body),
  fieldDicts: () => request<Record<string, unknown>>('/api/field-dicts'),
  chains: () => request<Record<string, unknown>>('/api/chains'),

  // 主流程
  run: (body: RunPayload) => post<Record<string, unknown>>('/api/run', body),
  clearColumn: (body: RunPayload) => post<Record<string, unknown>>('/api/clear-column', body),

  // 触发器
  triggers: (body?: RunPayload) => post<Record<string, unknown>>('/api/triggers', body),
}
