/** 轻量浮动提示（旧界面有一套 toast，迁移时漏了）：
 *  状态行容易被忽略，执行写库、清除、生成这类"结果性"动作额外弹一条。 */
import { ref } from 'vue'

export type ToastKind = 'ok' | 'warn' | 'err'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

const items = ref<ToastItem[]>([])
let seq = 0

/** 同一条文案不叠加，避免连点刷屏 */
export function toast(text: string, kind: ToastKind = 'ok', ttl = 3600) {
  const msg = String(text || '').trim()
  if (!msg) return
  if (items.value.some((t) => t.text === msg && t.kind === kind)) return
  const id = ++seq
  items.value = [...items.value, { id, text: msg, kind }]
  window.setTimeout(() => {
    items.value = items.value.filter((t) => t.id !== id)
  }, ttl)
}

export function dismissToast(id: number) {
  items.value = items.value.filter((t) => t.id !== id)
}

export function useToasts() {
  return items
}
