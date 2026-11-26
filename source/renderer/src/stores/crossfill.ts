/** 跨表带值页面的状态与副作用（对应旧界面 #tab-sync 的全部逻辑）。
 *  旧页面用 DOM 当状态存储，迁移后统一收敛到这里，避免"切单据后残留旧结果"。 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { clearColumn, fetchMeta, runFill, isCustomColumn } from '../api/crossfill'
import type { ClearResponse, Meta, PreviewResponse, RunRequest, RunResponse } from '../api/crossfill'

/** 付款单不能用这两个来源建档触发器（旧界面同样硬编码）。 */
const TRIGGER_BLOCKED_DOC = 'YSFGQB'
const TRIGGER_BLOCKED_SRCS = ['DCSHDA', 'DCSHDB']

export const useCrossFillStore = defineStore('crossfill', () => {
  const meta = ref<Meta | null>(null)
  const metaState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const metaError = ref('')

  const docId = ref('')
  const tgtCol = ref('')
  const srcId = ref('')
  const srcValCol = ref('')

  const force = ref(false)
  const createTrigger = ref(false)
  const mergeDisplay = ref(false)

  const preview = ref<PreviewResponse | null>(null)
  const previewKey = ref('')
  const running = ref(false)
  const result = ref<RunResponse | null>(null)
  const message = ref('')
  const messageKind = ref<'' | 'ok' | 'err'>('')

  const docs = computed(() => meta.value?.docs ?? [])
  const srcs = computed(() => meta.value?.srcs ?? [])
  const currentDb = computed(() => meta.value?.currentDb ?? '')

  const curDoc = computed(() => docs.value.find((d) => d.id === docId.value) ?? null)
  const curSrc = computed(() => srcs.value.find((s) => s.id === srcId.value) ?? null)

  /** 目标列：只保留自定义列（960–995），与后端校验一致 */
  const tgtCols = computed(() => {
    const all = meta.value?.tgtAllCols?.[docId.value] ?? []
    return all.filter((c) => c.custom === true || isCustomColumn(c.col))
  })

  /** 来源档：排除同家族（含头/身/选配）与自身 */
  const srcOptions = computed(() => {
    const excluded = meta.value?.srcExcluded?.[docId.value] ?? []
    return srcs.value.filter((s) => s.id !== docId.value && !excluded.includes(s.id))
  })

  const valCols = computed(() => meta.value?.srcAllCols?.[srcId.value] ?? [])

  const triggerBlocked = computed(
    () => docId.value === TRIGGER_BLOCKED_DOC && TRIGGER_BLOCKED_SRCS.includes(srcId.value),
  )

  const canPreview = computed(() => !!(docId.value && tgtCol.value.trim() && srcId.value && srcValCol.value.trim()))
  const clearEnabled = computed(
    () => !!docId.value && !!tgtCol.value.trim() && tgtCols.value.some((c) => c.col === tgtCol.value.trim()),
  )

  function setMessage(kind: '' | 'ok' | 'err', text: string) {
    messageKind.value = kind
    message.value = text
  }

  function buildRequest(confirm: boolean): RunRequest {
    return {
      docId: docId.value,
      tgtCol: tgtCol.value.trim(),
      srcId: srcId.value,
      srcValCol: srcValCol.value.trim(),
      partyKey: 1,
      mode: 'fill',
      confirm,
      force: force.value,
      chain: null,
      createTrigger: createTrigger.value,
      forceCreateTrigger: false,
      mergeDisplay: mergeDisplay.value,
      triggerTimeMode: 'none',
      mappings: [],
    }
  }

  /** 请求指纹：只有"预览过且配置变了"才拦截执行（旧界面同规则） */
  function keyOf(req: RunRequest): string {
    const { confirm: _confirm, ...rest } = req
    return JSON.stringify(rest)
  }

  async function loadMeta() {
    metaState.value = 'loading'
    metaError.value = ''
    try {
      meta.value = await fetchMeta()
      metaState.value = 'ready'
      resetForm()
    } catch (e) {
      metaState.value = 'error'
      metaError.value = e instanceof Error ? e.message : String(e)
    }
  }

  function resetForm() {
    docId.value = ''
    tgtCol.value = ''
    srcId.value = ''
    srcValCol.value = ''
    preview.value = null
    previewKey.value = ''
    result.value = null
    setMessage('', '')
  }

  function setDoc(id: string) {
    docId.value = id
    tgtCol.value = ''
    srcId.value = ''
    srcValCol.value = ''
    preview.value = null
    result.value = null
    setMessage('', '')
    if (triggerBlocked.value) createTrigger.value = false
  }

  function setSrc(id: string) {
    srcId.value = id
    srcValCol.value = ''
    preview.value = null
    result.value = null
    setMessage('', '')
    if (triggerBlocked.value) createTrigger.value = false
  }

  async function previewNow() {
    if (!canPreview.value) {
      setMessage('err', '请先选择单据、目标列、来源档与来源值列')
      return
    }
    running.value = true
    setMessage('', '')
    result.value = null
    try {
      const req = buildRequest(false)
      const resp = (await runFill(req)) as PreviewResponse
      preview.value = resp
      previewKey.value = keyOf(req)
      setMessage('ok', `预览完成：共 ${resp.totalRows ?? 0} 行待填入，审阅后点「执行」。`)
    } catch (e) {
      preview.value = null
      previewKey.value = ''
      setMessage('err', e instanceof Error ? e.message : String(e))
    } finally {
      running.value = false
    }
  }

  async function executeNow(): Promise<boolean> {
    if (!canPreview.value) {
      setMessage('err', '请先选择单据、目标列、来源档与来源值列')
      return false
    }
    const req = buildRequest(true)
    if (previewKey.value && previewKey.value !== keyOf(req)) {
      setMessage('err', '配置已经变化，请重新预览后再执行。')
      return false
    }
    const db = currentDb.value || '当前账套'
    if (!window.confirm(`确认执行写库？工具会先自动备份 ${db} 到备份目录。`)) return false

    running.value = true
    setMessage('', '')
    try {
      const resp = (await runFill(req)) as RunResponse
      result.value = resp
      preview.value = null
      previewKey.value = ''
      setMessage('ok', `已写入数据库，受影响 ${resp.affected ?? 0} 行`)
      return true
    } catch (e) {
      setMessage('err', e instanceof Error ? e.message : String(e))
      return false
    } finally {
      running.value = false
    }
  }

  /** 清除目标字段：整表整列，两段式（先问行数再确认） */
  async function clearTgtCol(): Promise<ClearResponse | null> {
    if (!clearEnabled.value) return null
    const body = { docId: docId.value, tgtCol: tgtCol.value.trim(), confirm: false }
    try {
      const probe = await clearColumn(body)
      const count = probe.count ?? 0
      if (!count) {
        setMessage('ok', '该列没有可清除的值')
        return probe
      }
      if (!window.confirm(`确认清除该列全部 ${count} 个非空值？清除前会自动备份。`)) return null
      const done = await clearColumn({ ...body, confirm: true })
      setMessage('ok', `已清除 ${done.affected ?? count} 行`)
      preview.value = null
      previewKey.value = ''
      return done
    } catch (e) {
      setMessage('err', e instanceof Error ? e.message : String(e))
      return null
    }
  }

  return {
    meta,
    metaState,
    metaError,
    docs,
    srcs,
    currentDb,
    docId,
    tgtCol,
    srcId,
    srcValCol,
    force,
    createTrigger,
    mergeDisplay,
    curDoc,
    curSrc,
    tgtCols,
    srcOptions,
    valCols,
    triggerBlocked,
    canPreview,
    clearEnabled,
    preview,
    previewKey,
    running,
    result,
    message,
    messageKind,
    loadMeta,
    resetForm,
    setDoc,
    setSrc,
    previewNow,
    executeNow,
    clearTgtCol,
  }
})
