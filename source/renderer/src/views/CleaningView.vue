<script setup lang="ts">
/** 数据清洗（P3）：模板库 → 来源数据 → 读取 → 字段规则 → 预览 → 生成。
 *  行为对齐旧界面 #tab-cleaning：只读校验不写数据库，生成前必须预览通过。 */
import { computed, onMounted, ref } from 'vue'
import {
  cleaningApi,
  fileToBase64,
  TRANSFORMS,
  type CleanApplyResult,
  type CleanInspectResult,
  type CleanIssue,
  type CleanMappingColumn,
  type CleanTemplateItem,
} from '../api/cleaning'

const templates = ref<CleanTemplateItem[]>([])
const templateId = ref('')
const templateFile = ref<File | null>(null)
const sourceFile = ref<File | null>(null)
const autoOpen = ref(true)

const jobId = ref('')
const info = ref<CleanInspectResult | null>(null)
const mapping = ref<CleanMappingColumn[]>([])
const stats = ref<CleanApplyResult['stats'] | null>(null)
const issues = ref<CleanIssue[]>([])
const xlsPath = ref('')
const xlsIsPreview = ref(false)
const previewOk = ref(false)

const statusText = ref('')
const statusKind = ref<'ok' | 'err' | ''>('')
const reading = ref(false)
const previewing = ref(false)
const generating = ref(false)
const importing = ref(false)
const deleteArmed = ref(false)

const shownIssues = computed(() =>
  issues.value.filter((x) => x.severity === 'error' || x.severity === 'warning').slice(0, 40),
)
const badCodes = computed(() => {
  const set = new Set<string>()
  issues.value
    .filter((x) => x.severity === 'error')
    .forEach((x) => String(x.code || '').split('+').filter(Boolean).forEach((c) => set.add(c)))
  return set
})
const hasJob = computed(() => !!jobId.value)
const srcColumnLabel = computed(() => {
  const name = String(info.value?.source?.fileName || '客户数据').replace(/\.(xls|xlsx|xlsm)$/i, '')
  return name
})
const summary = computed(() => {
  const it = info.value
  if (!it) return null
  return {
    profile: it.suggested?.profile || '—',
    cols: it.template?.columns?.length ?? 0,
    rows: it.source?.rowCount ?? 0,
    remembered: it.suggested?.rememberedCount ?? 0,
  }
})
const ruleNote = computed(() => {
  const list = mapping.value
  const required = list.filter((c) => c.required).length
  const fixed = list.filter((c) => c.fixed || c.derivedFrom).length
  const options = list.filter((c) => !c.fixed && !c.derivedFrom && (c.options?.length ?? 0) > 0).length
  const mapped = list.filter((c) => c.sourceIndex != null).length
  return `必填 ${required} · 固定 ${fixed} · 下拉 ${options} · 已匹配 ${mapped}`
})
function setStatus(msg: string, kind: 'ok' | 'err' | '' = '') {
  statusText.value = msg
  statusKind.value = kind
}
function fileSize(f: File) {
  return `${(f.size / 1024).toFixed(1)} KB`
}
function fileName(path: string) {
  return String(path || '').split(/[\\/]/).pop() || '导入包.xls'
}

/** 后端 transformFor 可能给出 deptFlag 等未在固定列表里的值，原样补一个选项，避免下拉显示错位 */
function transformOptions(c: CleanMappingColumn) {
  const cur = c.transform || 'text'
  if (TRANSFORMS.some((t) => t.value === cur)) return TRANSFORMS
  return [...TRANSFORMS, { value: cur, label: `${cur}（模板规则）` }]
}

function resetJob() {
  jobId.value = ''
  info.value = null
  mapping.value = []
  stats.value = null
  issues.value = []
  xlsPath.value = ''
  previewOk.value = false
  deleteArmed.value = false
}

async function loadTemplates(selected?: string) {
  try {
    const r = await cleaningApi.templates()
    templates.value = r.templates || []
  } catch {
    templates.value = []
  }
  if (selected) templateId.value = selected
  if (templateId.value && !templates.value.some((t) => t.id === templateId.value)) templateId.value = ''
}

function onTemplatePick() {
  templateFile.value = null
  resetJob()
  setStatus('')
}

function onTemplateFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  templateFile.value = f
  templateId.value = ''
  resetJob()
  setStatus('')
}

async function importTemplate() {
  const f = templateFile.value
  if (!f) return
  importing.value = true
  try {
    const data = await fileToBase64(f)
    const r = await cleaningApi.importTemplate(f.name, data)
    templateFile.value = null
    await loadTemplates(r.id)
    setStatus(`模板已保存：${r.name || f.name}`)
  } catch (e) {
    setStatus(`模板保存失败：${(e as Error).message}`, 'err')
  } finally {
    importing.value = false
  }
}

async function removeTemplate() {
  const id = templateId.value
  if (!id) return
  // 不用原生 confirm：部分窗口会吞掉对话框，改成两次点击确认
  if (!deleteArmed.value) {
    deleteArmed.value = true
    setStatus('再点一次「确认删除」；只删除模板库文件，不影响已生成的 XLS。')
    window.setTimeout(() => (deleteArmed.value = false), 5000)
    return
  }
  deleteArmed.value = false
  try {
    await cleaningApi.deleteTemplate(id)
    templateId.value = ''
    resetJob()
    await loadTemplates()
    setStatus('模板已删除。')
  } catch (e) {
    setStatus(`删除模板失败：${(e as Error).message}`, 'err')
  }
}

function onSourceFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  sourceFile.value = f
  resetJob()
  setStatus('')
}

async function read() {
  const s = sourceFile.value
  if (!s || (!templateFile.value && !templateId.value)) {
    setStatus('请先选择模板和来源数据', 'err')
    return
  }
  reading.value = true
  resetJob()
  setStatus('正在读取模板和来源数据（需要本机 Excel）...')
  try {
    const [sd, td] = await Promise.all([
      fileToBase64(s),
      templateFile.value ? fileToBase64(templateFile.value) : Promise.resolve(''),
    ])
    const payload: Parameters<typeof cleaningApi.inspect>[0] = { source: { name: s.name, data: sd } }
    if (templateFile.value) payload.template = { name: templateFile.value.name, data: td }
    else payload.templateId = templateId.value

    const r = await cleaningApi.inspect(payload)
    jobId.value = r.jobId
    info.value = r
    mapping.value = (r.suggested?.columns || []).map((c) => ({ ...c }))
    if (r.templateId) {
      await loadTemplates(r.templateId)
    }
    setStatus('读取完成，请检查字段规则，再点【预览】。')
  } catch (e) {
    setStatus(`读取失败：${(e as Error).message}`, 'err')
  } finally {
    reading.value = false
  }
}

function collectMapping(): CleanMappingColumn[] {
  return mapping.value.map((c) => ({
    code: c.code,
    sourceIndex: c.sourceIndex ?? null,
    transform: c.transform,
    defaultValue: c.defaultValue,
    otherwise: c.otherwise || '',
    derivedFrom: c.derivedFrom,
    required: !!c.required,
    options: c.options || [],
    fixed: !!c.fixed,
    editable: c.editable !== false,
  }))
}

let rememberTimer = 0
function rememberSoon() {
  window.clearTimeout(rememberTimer)
  rememberTimer = window.setTimeout(() => {
    if (!jobId.value) return
    cleaningApi.remember(jobId.value, collectMapping()).catch(() => {})
  }, 300)
}

function onCellChange(col: CleanMappingColumn, field: 'sourceIndex' | 'transform' | 'defaultValue', value: string) {
  previewOk.value = false
  if (field === 'sourceIndex') {
    col.sourceIndex = value === '' ? null : Number(value)
  } else if (field === 'transform') {
    col.transform = value
  } else {
    col.defaultValue = value
    // 枚举字段选了具体值视为“覆盖来源”，否则来源列与模板枚举冲突的行改不回来
    if (value !== '' && col.sourceIndex != null) col.sourceIndex = null
    rememberSoon()
  }
}

function renderResult(r: CleanApplyResult) {
  stats.value = r.stats || {}
  issues.value = r.issues || []
}

async function validate(): Promise<CleanApplyResult | null> {
  const pre = await cleaningApi.preview(jobId.value, collectMapping())
  renderResult(pre)
  previewOk.value = Number(pre.stats?.errors || 0) === 0
  return pre
}

async function preview() {
  if (!hasJob.value) return setStatus('请先点【读取】', 'err')
  previewing.value = true
  try {
    setStatus('正在校验并生成预览文件...')
    const pre = await validate()
    if (!pre) return
    if (Number(pre.stats?.errors || 0) > 0) {
      setStatus(`发现 ${pre.stats.errors} 个硬错误，请补默认值或调整来源列后重新预览。`, 'err')
      return
    }
    const out = await cleaningApi.generate(jobId.value, collectMapping(), true)
    renderResult(out)
    xlsPath.value = out.xlsPath || ''
    xlsIsPreview.value = true
    setStatus(`预览文件已生成：${out.stats?.outputRows || 0} 行，请打开检查，没问题再点【生成】。`)
    if (autoOpen.value && xlsPath.value && window.nb?.openCleaningFile) {
      try {
        await window.nb.openCleaningFile(xlsPath.value)
        setStatus('预览文件已打开，请人工确认后点【生成】。')
      } catch (e) {
        setStatus(`预览文件已生成；自动打开失败：${(e as Error).message}`, 'err')
      }
    }
  } catch (e) {
    setStatus(`预览失败：${(e as Error).message}`, 'err')
  } finally {
    previewing.value = false
  }
}

async function generate() {
  if (!hasJob.value) return setStatus('请先点【读取】', 'err')
  generating.value = true
  try {
    setStatus('正在生成正式导入包...')
    const pre = await validate()
    if (!pre) return
    if (Number(pre.stats?.errors || 0) > 0) {
      setStatus(`发现 ${pre.stats.errors} 个硬错误，未生成导入包。请补默认值或调整来源列后重新预览。`, 'err')
      return
    }
    const out = await cleaningApi.generate(jobId.value, collectMapping(), false)
    renderResult(out)
    xlsPath.value = out.xlsPath || ''
    xlsIsPreview.value = false
    setStatus(`生成完成：${out.stats?.outputRows || 0} 行。`)
  } catch (e) {
    setStatus(`生成失败：${(e as Error).message}`, 'err')
  } finally {
    generating.value = false
  }
}

async function saveAs() {
  if (!window.nb?.saveCleaningFile) {
    setStatus('当前版本不支持另存为，请使用新版桌面程序', 'err')
    return
  }
  try {
    const r = await window.nb.saveCleaningFile(xlsPath.value, fileName(xlsPath.value))
    if (r?.ok) setStatus(`已另存为：${r.path}`)
    else if (r?.canceled) setStatus('已取消另存为。')
  } catch (e) {
    setStatus(`另存为失败：${(e as Error).message}`, 'err')
  }
}

async function reveal() {
  try {
    await cleaningApi.reveal(xlsPath.value)
  } catch (e) {
    setStatus((e as Error).message, 'err')
  }
}

function locate(issue: CleanIssue) {
  const code = String(issue.code || '').split('+')[0]
  const el = document.getElementById(`clean-row-${code}`)
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.classList.add('target-hit')
  window.setTimeout(() => el.classList.remove('target-hit'), 1400)
  const box = el.querySelector<HTMLElement>('select:not(:disabled),input:not(:disabled)')
  if (box) box.focus({ preventScroll: true })
}

onMounted(() => loadTemplates())
</script>

<template>
  <section class="page">
    <div class="paper-card head">
      <div>
        <div class="kicker">MODULE 02 · 期初导入</div>
        <h2>数据清洗与导入</h2>
      </div>
      <span class="pill">只读校验 · 不写数据库</span>
    </div>

    <div class="file-grid">
      <div class="paper-card file">
        <div class="lbl">01 目标模板</div>
        <select v-model="templateId" :disabled="importing" @change="onTemplatePick">
          <option value="">—— 请选择已保存模板 ——</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name || t.fileName || '未命名模板' }}</option>
        </select>
        <div class="file-actions">
          <label class="btn sm">
            选择模板文件
            <input type="file" accept=".xls,.xlsx,.xlsm" hidden @change="onTemplateFile" />
          </label>
          <button class="btn sm" type="button" :disabled="!templateFile || importing" @click="importTemplate">
            {{ importing ? '保存中...' : '导入模板文件' }}
          </button>
          <button class="btn sm danger" type="button" :disabled="!templateId" @click="removeTemplate">
            {{ deleteArmed ? '确认删除' : '删除模板' }}
          </button>
        </div>
        <p v-if="templateFile" class="sub">{{ templateFile.name }} · {{ fileSize(templateFile) }}</p>
      </div>

      <div class="paper-card file">
        <div class="lbl">02 来源数据</div>
        <div class="src-row">
          <label class="btn sm">
            {{ sourceFile ? sourceFile.name : '选择客户数据' }}
            <input type="file" accept=".xls,.xlsx,.xlsm" hidden @change="onSourceFile" />
          </label>
          <span class="sub">{{ sourceFile ? fileSize(sourceFile) : '(.xls / .xlsx)' }}</span>
        </div>
        <div class="file-actions">
          <button class="btn primary" type="button" :disabled="reading" @click="read">
            {{ reading ? '读取中...' : '读取' }}
          </button>
          <button class="btn" type="button" :disabled="!hasJob || previewing" @click="preview">
            {{ previewing ? '预览中...' : '预览' }}
          </button>
          <button class="btn primary" type="button" :disabled="!hasJob || !previewOk || generating" @click="generate">
            {{ generating ? '生成中...' : '生成' }}
          </button>
        </div>
      </div>
    </div>

    <div class="paper-card auto-row">
      <label class="chk"><input v-model="autoOpen" type="checkbox" /> 预览时自动打开文件，人工确认</label>
      <span class="sub">黄色单元格表示按简称匹配，需人工确认；来源列选错会报错并定位。</span>
    </div>

    <p v-if="statusText" class="status" :class="statusKind">{{ statusText }}</p>

    <div v-if="summary" class="paper-card summary">
      已识别 <b>{{ summary.profile }}</b> 模板（{{ summary.cols }} 列）和 <b>{{ summary.rows }}</b> 行客户数据。
      <template v-if="summary.remembered">
        <br /><span class="ok">已载入这个模板上次保存的 {{ summary.remembered }} 个默认值；换模板不会混用。</span>
      </template>
      <br /><span class="sub">系统按当前模板批注匹配、校验；需要系统资料的字段可在下方输入默认值，下次同一模板自动带出。</span>
    </div>

    <div v-if="mapping.length" class="paper-card block">
      <div class="block-head">
        <strong>字段规则</strong>
        <span class="sub">{{ ruleNote }}</span>
      </div>
      <p class="sub">来源有值优先；只有来源为空才使用默认值。固定值不可改。</p>
      <div class="map-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>目标字段</th>
              <th>来源列</th>
              <th>清洗方式</th>
              <th>默认值 / 固定值</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in mapping"
              :id="`clean-row-${c.code}`"
              :key="c.code"
              :class="{ bad: badCodes.has(c.code), fixed: c.fixed || c.derivedFrom }"
            >
              <td>
                <span class="code">{{ c.code }}</span>
                <span v-if="c.fixed" class="tag">固定</span>
                <span v-if="badCodes.has(c.code)" class="tag danger">问题</span>
                <span class="name" :title="c.comment || c.name || ''">
                  {{ c.name || '' }}<span v-if="c.required" class="tag danger">必填</span>
                </span>
              </td>
              <td>
                <select
                  :value="c.sourceIndex ?? ''"
                  :disabled="!!c.fixed || !!c.derivedFrom"
                  @change="onCellChange(c, 'sourceIndex', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">{{ c.fixed || c.derivedFrom ? '不映射' : '— 不映射 —' }}</option>
                  <option v-for="s in info?.source?.columns || []" :key="s.index" :value="s.index">
                    {{ srcColumnLabel }} 第 {{ s.index }} 列
                  </option>
                </select>
              </td>
              <td>
                <select
                  :value="c.transform || 'text'"
                  :disabled="!!c.fixed || !!c.derivedFrom"
                  @change="onCellChange(c, 'transform', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="t in transformOptions(c)" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
              </td>
              <td>
                <input v-if="c.derivedFrom" type="text" :value="`取 ${c.derivedFrom}`" disabled />
                <select
                  v-else-if="c.fixed || (c.options && c.options.length)"
                  :value="c.defaultValue || ''"
                  :disabled="!!c.fixed"
                  @change="onCellChange(c, 'defaultValue', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-if="!c.fixed" value="">— 空 —</option>
                  <option v-for="o in c.options && c.options.length ? c.options : [{ value: c.defaultValue || '', label: '' }]" :key="o.value" :value="o.value">
                    {{ o.value }}{{ o.label ? ` · ${o.label}` : '' }}
                  </option>
                </select>
                <input
                  v-else
                  type="text"
                  :value="c.defaultValue || ''"
                  placeholder="来源为空时使用"
                  @change="onCellChange(c, 'defaultValue', ($event.target as HTMLInputElement).value)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="stats" class="stats">
      <span>来源 <b>{{ stats.sourceRows || 0 }}</b> 行</span>
      <span>输出 <b>{{ stats.outputRows || 0 }}</b> 行</span>
      <span class="err">问题 <b>{{ stats.errors || 0 }}</b></span>
    </div>

    <div v-if="issues.length" class="paper-card block">
      <div class="block-head">
        <strong>校验问题</strong>
        <span class="sub">双击问题行可定位到下方对应字段</span>
      </div>
      <div v-if="!shownIssues.length" class="issue info"><span class="sev">通过</span><span>没有硬错误或警告。</span></div>
      <div
        v-for="(x, i) in shownIssues"
        :key="i"
        class="issue"
        :class="x.severity"
        @dblclick="locate(x)"
      >
        <span class="sev">{{ x.severity === 'error' ? '错误' : '提示' }}</span>
        <span class="msg">{{ x.message }}</span>
        <span class="loc">{{ x.code || '' }}{{ x.row ? ` · 行${x.row}` : '' }}</span>
      </div>
    </div>

    <div v-if="xlsPath" class="paper-card block">
      <div class="block-head">
        <strong>{{ xlsIsPreview ? '预览文件已生成' : '生成成功' }}</strong>
        <span class="sub">{{ xlsIsPreview ? '用于人工检查，确认无误后再点【生成】' : `共 ${stats?.outputRows || 0} 行` }}</span>
      </div>
      <p class="sub">文件：<span class="path">{{ xlsPath }}</span></p>
      <div class="file-actions">
        <button class="btn sm" type="button" @click="saveAs">另存为…</button>
        <button class="btn sm" type="button" @click="reveal">打开文件夹</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page {
  padding: 12px 0 26px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.head {
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.kicker {
  font-size: var(--fs-kicker);
  letter-spacing: 1.2px;
  color: var(--ink-3);
  font-weight: 600;
}

.head h2 {
  font-size: 20px;
  margin: 2px 0 4px;
}

.pill {
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-2);
  background: var(--wash);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 10px;
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.file {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: auto;
}

.src-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.lbl {
  font-size: 12.5px;
  color: var(--ink-2);
}

select,
input[type='text'] {
  width: 100%;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 7px 10px;
  outline: none;
}

select:focus,
input[type='text']:focus {
  border-color: var(--seal);
}

select:disabled,
input:disabled {
  background: var(--wash);
  color: var(--ink-3);
}

.btn {
  font-family: inherit;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 7px 14px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  border-color: var(--ink-3);
}

.btn:disabled {
  color: var(--ink-3);
  cursor: not-allowed;
  background: var(--wash);
}

.btn.primary {
  background: var(--seal);
  border-color: var(--seal);
  color: #fff;
}

.btn.primary:disabled {
  background: var(--wash);
  border-color: var(--line);
  color: var(--ink-3);
}

.btn.danger {
  color: var(--seal);
}

.btn.sm {
  padding: 5px 12px;
  font-size: 12.5px;
}

.auto-row {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
}

.status {
  margin: 0;
  font-size: 13px;
  color: var(--ink-2);
}

.status.ok {
  color: var(--ok);
}

.status.err {
  color: var(--seal);
}

.summary {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.8;
}

.summary b {
  color: var(--ink);
}

.ok {
  color: var(--ok);
}

.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-3);
}

.err {
  color: var(--seal);
}

.block {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.block-head strong {
  font-size: var(--fs-section);
  font-weight: 600;
}

.map-wrap {
  overflow: auto;
  max-height: 60vh;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
}

table.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

table.grid th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  font-weight: 600;
  color: var(--ink-2);
  background: var(--paper-3);
  border-bottom: 1px solid var(--line);
  padding: 8px 10px;
  white-space: nowrap;
}

table.grid td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}

table.grid tr:last-child td {
  border-bottom: none;
}

table.grid tr.fixed {
  background: var(--wash);
}

table.grid tr.bad {
  background: var(--seal-wash);
}

table.grid tr.target-hit {
  outline: 2px solid var(--seal);
  outline-offset: -2px;
}

.code {
  font-family: Consolas, monospace;
  color: var(--ink-2);
  margin-right: 6px;
}

.name {
  color: var(--ink);
}

.tag {
  margin-left: 6px;
  font-size: 11px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--wash);
  color: var(--ink-3);
}

.tag.danger {
  background: var(--seal-wash);
  color: var(--seal);
}

.stats {
  display: flex;
  gap: 18px;
  font-size: 13px;
  color: var(--ink-2);
  padding: 0 4px;
}

.stats b {
  color: var(--ink);
}

.issue {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12.5px;
  padding: 5px 8px;
  border-radius: 4px;
  background: var(--paper-3);
}

.issue.error .sev {
  color: var(--seal);
}

.issue.warning .sev {
  color: var(--warn);
}

.issue.info .sev {
  color: var(--ok);
}

.issue .sev {
  font-weight: 600;
  white-space: nowrap;
}

.issue .msg {
  color: var(--ink);
  flex: 1;
}

.issue .loc {
  color: var(--ink-3);
  white-space: nowrap;
}

.path {
  font-family: Consolas, monospace;
  font-size: 12px;
  color: var(--ink-2);
  word-break: break-all;
}
</style>
