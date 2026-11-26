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

export interface CredRecord {
  user: string
  pass: string
  /** 该服务器上次用的账套：后端 /api/save-config 会写进 prefs[server].db */
  db?: string
}

export interface CredPrefs {
  user?: string
  pass?: string
  db?: string
}

export interface CredsPayload {
  ok?: boolean
  data?: Record<string, CredRecord | undefined> & {
    _last?: CredRecord
    _lastServer?: string
    prefs?: Record<string, CredPrefs>
  }
}

/** 后端 onboardingState()（app.js:1024-1090 附近）：判断本机是否还没配过数据库 */
export interface OnboardingState {
  ok?: boolean
  configured?: boolean
  onboardingDone?: boolean
  needsSetup?: boolean
  existingInstall?: boolean
  newInstall?: boolean
  freshInstall?: boolean
}

export const api = {
  // 连接与配置
  config: () => request<DbConfig>('/api/config'),
  saveConfig: (body: Partial<DbConfig>) => post<{ ok?: boolean }>('/api/save-config', body),
  /** dryRun=true 只探活，不写配置、不切主连接池 */
  testConn: (body: Partial<DbConfig> & { dryRun?: boolean }) =>
    post<{ ok?: boolean; error?: string; hint?: string; autoApplied?: boolean; note?: string }>('/api/test-conn', body),
  databases: (body?: Partial<DbConfig>) => post<DbListPayload>('/api/databases', body),
  /** GET 分支：不传参数、只列当前配置那台服务器的账套（旧版 initDbConn 用它兜底） */
  databasesGet: () => request<DbListPayload>('/api/databases'),
  switchDb: (database: string) => post<{ ok?: boolean; database?: string; server?: string }>('/api/switch-db', { database }),
  /** 不传 dir：后端弹原生目录选择框 */
  setBackupDir: (dir?: string) =>
    post<{ ok?: boolean; canceled?: boolean; backupDir?: string; error?: string }>('/api/backup-dir', dir ? { dir } : {}),

  // 凭据记忆（旧版「保存配置」同时写 creds.json，重启才不会被旧凭据覆盖）
  creds: () => request<CredsPayload>('/api/creds'),
  saveCreds: (body: Record<string, CredRecord>) => post<{ ok?: boolean }>('/api/creds/save', body),


  // 元数据与字典（泛型由调用方给强类型，避免页面里 `as unknown as`）
  meta: <T = MetaPayload>(body?: unknown) => post<T>('/api/meta', body),

  // 首次使用向导
  onboarding: () => request<OnboardingState>('/api/onboarding'),
  finishOnboarding: () => post<OnboardingState>('/api/onboarding'),

  // 主流程
  run: <T = Record<string, unknown>>(body: RunPayload) => post<T>('/api/run', body),
  clearColumn: <T = Record<string, unknown>>(body: RunPayload) => post<T>('/api/clear-column', body),
}
