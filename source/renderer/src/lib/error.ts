/** 错误统一转成人能读的一句话：后端 hint（账号/防火墙/TLS/库不存在）附在后面。 */
import { ApiError } from '../api/client'

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.hint ? `${e.message}${e.hint}` : e.message
  if (e instanceof Error) return e.message
  return typeof e === 'string' && e ? e : '未知错误'
}
