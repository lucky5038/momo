/** 跨表带值页面的状态与副作用（对应旧界面 #tab-sync 的全部逻辑）。
 *  旧页面用 DOM 当状态存储，迁移后统一收敛到这里，避免"切单据后残留旧结果"。
 *
 *  三处容易踩的坑，这里都做了约束：
 *   1. 换单据/换来源/换目标列 → 预览与结果一律清空，连 previewKey 一起清，否则执行时会误报"配置已变化"
 *   2. 预览与执行分两个标志，避免预览时执行按钮显示"执行中…"
 *   3. 切账套后 meta 必须失效，否则旧列字典会拿去写新库 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '../api/client'
import { clearColumn, fetchMeta, runFill, isCustomColumn } from '../api/crossfill'
import type { ClearResponse, Meta, PreviewResponse, RunRequest, RunResponse } from '../api/crossfill'
import { useStatus } from '../composables/useStatus'
import { errorMessage } from '../lib/error'

/** 付款单不能用这两个来源建档触发器（旧界面同样硬编码）。 */
const TRIGGER_BLOCKED_DOC = 'YSFGQB'
const TRIGGER_BLOCKED_SRCS = ['DCSHDA', 'DCSHDB']

export const useCrossFillStore = defineStore('crossfill', () => {
  const status = useStatus()

  const meta = ref<Meta | null>(null)
  const metaState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const metaError = ref('')
  const backupDir = ref('')

  const docId = ref('')
  const tgtCol = ref('')
  const srcId = ref('')
  const srcValCol = ref('')

  const force = ref(false)
  const createTrigger = ref(false)
  const mergeDisplay = ref(false)

  const preview = ref<PreviewResponse | null>(null)
  const previewKey = ref('')
  const previewing = ref(false)
  const executing = ref(false)
  const clearing = ref(false)
  const busy = computed(() => previewing.value || executing.value || clearing.value)
  const result = ref<RunResponse | null>(null)

  /** 请求序号：切单据/切账套后旧响应回来直接丢弃，避免覆盖新状态 */
  let metaSeq = 0
  let runSeq = 0

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

  function clearPreview() {
    preview.value = null
    previewKey.value = ''
  }

  function clearRunState() {
    clearPreview()
    result.value = null
  }

  async function loadMeta() {
    const seq = ++metaSeq
    metaState.value = 'loading'
    metaError.value = ''
    try {
      const [m, cfg] = await Promise.all([fetchMeta(), api.config().catch(() => null)])
      if (seq !== metaSeq) return
      meta.value = m
      backupDir.value = cfg?.backupDir || ''
      metaState.value = 'ready'
      resetForm()
    } catch (e) {
      if (seq !== metaSeq) return
      metaState.value = 'error'
      metaError.value = errorMessage(e)
    }
  }

  /** 账套切换/重新连接后调用：旧字典不能再用 */
  function invalidate() {
    metaSeq++
    runSeq++
    meta.value = null
    metaState.value = 'idle'
    metaError.value = ''
    resetForm()
  }

  function resetForm() {
    docId.value = ''
    tgtCol.value = ''
    srcId.value = ''
    srcValCol.value = ''
    createTrigger.value = false
    clearRunState()
    status.reset()
  }

  function setDoc(id: string) {
    docId.value = id
    tgtCol.value = ''
    srcId.value = ''
    srcValCol.value = ''
    createTrigger.value = false
    clearRunState()
    status.reset()
  }

  function setSrc(id: string) {
    srcId.value = id
    srcValCol.value = ''
    clearRunState()
    status.reset()
    // 付款单 + 采购/委托来源不支持建触发器，选完来源再判，避免死分支
    if (triggerBlocked.value) createTrigger.value = false
  }

  /** 目标列由下拉直接写 store 时要清预览，否则表格还是上一列的样本 */
  function setTgtCol(col: string) {
    tgtCol.value = col
    clearRunState()
    status.reset()
  }

  function setSrcValCol(col: string) {
    srcValCol.value = col
    clearRunState()
    status.reset()
  }

  async function previewNow() {
    if (!canPreview.value) {
      status.set('err', '请先选择单据、目标列、来源档与来源值列')
      return
    }
    const seq = ++runSeq
    previewing.value = true
    result.value = null
    status.reset()
    try {
      const req = buildRequest(false)
      const resp = await runFill<PreviewResponse>(req)
      if (seq !== runSeq) return
      preview.value = resp
      previewKey.value = keyOf(req)
      const total = resp.totalRows ?? 0
      const shown = resp.sample?.length ?? 0
      const truncated = shown > 0 && shown < total ? `（预览表仅显示前 ${shown} 行）` : ''
      status.set('ok', `预览完成：共 ${total} 行待填入${truncated}，审阅后点「执行」。`)
    } catch (e) {
      if (seq !== runSeq) return
      clearPreview()
      status.fail(e)
    } finally {
      if (seq === runSeq) previewing.value = false
    }
  }

  async function executeNow(): Promise<boolean> {
    if (!canPreview.value) {
      status.set('err', '请先选择单据、目标列、来源档与来源值列')
      return false
    }
    const req = buildRequest(true)
    if (previewKey.value && previewKey.value !== keyOf(req)) {
      status.set('err', '配置已经变化，请重新预览后再执行。')
      return false
    }
    const db = currentDb.value || '当前账套'
    const backupText = backupDir.value ? `备份目录 ${backupDir.value}` : '备份目录同设置页'
    if (!window.confirm(`确认执行写库？\n账套：${db}\n执行前自动整库备份（${backupText}）。`)) return false

    const seq = ++runSeq
    executing.value = true
    status.reset()
    try {
      const resp = await runFill<RunResponse>(req)
      if (seq !== runSeq) return false
      result.value = resp
      clearPreview()
      status.set('ok', `已写入数据库，受影响 ${resp.affected ?? 0} 行`)
      return true
    } catch (e) {
      if (seq !== runSeq) return false
      status.fail(e)
      return false
    } finally {
      if (seq === runSeq) executing.value = false
    }
  }

  /** 清除目标字段：整表整列，两段式（先问行数再确认） */
  async function clearTgtCol(): Promise<ClearResponse | null> {
    if (!clearEnabled.value || busy.value) return null
    const col = tgtCol.value.trim()
    const body = { docId: docId.value, tgtCol: col, confirm: false }
    clearing.value = true
    try {
      const probe = await clearColumn(body)
      const count = probe.count ?? 0
      if (!count) {
        status.set('ok', '该列没有可清除的值')
        return probe
      }
      const who = `${curDoc.value?.name ?? docId.value} · ${col}`
      if (!window.confirm(`确认清除 ${who} 的全部 ${count} 个非空值？\n清除前自动整库备份。`)) return null
      const done = await clearColumn({ ...body, confirm: true })
      const backup = done.backupPath ? `，备份：${done.backupPath}` : ''
      status.set('ok', `已清除 ${done.affected ?? count} 行${backup}`)
      clearPreview()
      return done
    } catch (e) {
      status.fail(e, '清除失败：')
      return null
    } finally {
      clearing.value = false
    }
  }

  return {
    meta,
    metaState,
    metaError,
    backupDir,
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
    previewing,
    executing,
    busy,
    result,
    message: status.text,
    messageKind: status.kind,
    loadMeta,
    invalidate,
    resetForm,
    setDoc,
    setSrc,
    setTgtCol,
    setSrcValCol,
    previewNow,
    executeNow,
    clearTgtCol,
  }
})
