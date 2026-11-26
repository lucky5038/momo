/** 页面状态提示的统一实现：四处重复的 setMessage/errorText 收敛成一份。
 *  用法：const status = useStatus(); status.set('err', errorMessage(e)); status.reset() */
import { ref } from 'vue'
import { errorMessage } from '../lib/error'

export type StatusKind = '' | 'ok' | 'err' | 'warn'

export interface StatusState {
  text: ReturnType<typeof ref<string>>
  kind: ReturnType<typeof ref<StatusKind>>
  set(kind: StatusKind, text: string): void
  fail(e: unknown, prefix?: string): void
  reset(): void
}

export function useStatus(): StatusState {
  const text = ref('')
  const kind = ref<StatusKind>('')

  function set(k: StatusKind, t: string) {
    kind.value = k
    text.value = t
  }

  function fail(e: unknown, prefix = '') {
    set('err', prefix + errorMessage(e))
  }

  function reset() {
    kind.value = ''
    text.value = ''
  }

  return { text, kind, set, fail, reset }
}
