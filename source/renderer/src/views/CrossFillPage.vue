<script setup lang="ts">
/** 跨表带值（P2）：01 目标 → 02 来源 → 高级选项 → 预览/执行。
 *  行为对齐旧界面 #tab-sync，差异只在"切单据/来源会清空旧结果"这一处（旧版会残留）。 */
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import ColumnCombo from '../components/ColumnCombo.vue'
import { useCrossFillStore } from '../stores/crossfill'

const store = useCrossFillStore()
const {
  docs,
  docId,
  tgtCol,
  srcId,
  srcValCol,
  force,
  createTrigger,
  mergeDisplay,
  curDoc,
  tgtCols,
  srcOptions,
  valCols,
  triggerBlocked,
  canPreview,
  clearEnabled,
  preview,
  running,
  result,
  message,
  messageKind,
  metaState,
  metaError,
} = storeToRefs(store)

onMounted(() => {
  if (!docs.value.length) store.loadMeta()
})

const docSub = computed(() => {
  if (metaState.value === 'loading') return '正在加载单据字典，请稍候...'
  if (metaState.value === 'error') return metaError.value
  const d = curDoc.value
  if (!d) return ''
  const party = d.party === 'supplier' ? '供应商' : d.party === 'customer' ? '客户' : '无往来维度'
  return `${d.sub} · 品号列 ${d.refCol || d.keyCol} · ${party}`
})

const tgtSub = computed(() => {
  if (!docId.value) return ''
  const n = tgtCols.value.length
  return n ? `共 ${n} 个自定义字段（系统默认字段不支持带值，请选择）` : '该单据没有自定义字段（960–995），不能传值'
})

const valSub = computed(() => {
  if (!srcId.value) return '请先选择来源档'
  return `共 ${valCols.value.length} 个可选值列`
})

const previewTitle = computed(() => {
  if (!preview.value) return ''
  const d = curDoc.value
  return `目标 ${d ? `${d.sub}.${tgtCol.value}` : tgtCol.value} ← 来源 ${srcId.value}.${srcValCol.value}`
})

const banners = computed(() => {
  const p = preview.value
  if (!p) return [] as { kind: string; text: string }[]
  return [p.typeWarning, p.chainWarning, p.mergeNote, p.partyNote, p.note]
    .filter((t): t is string => !!t)
    .map((text) => ({ kind: 'note', text }))
})

function onDocChange() {
  store.setDoc(docId.value)
}

function onSrcChange() {
  store.setSrc(srcId.value)
}

async function onClear() {
  await store.clearTgtCol()
}

async function onExecute() {
  await store.executeNow()
}
</script>

<template>
  <section class="page">
    <div class="flow">
      <div class="paper-card card">
        <div class="step"><b>01</b> 目标</div>

        <label class="lbl">目标单据（主表）</label>
        <select v-model="docId" :disabled="!docs.length" :title="docSub" @change="onDocChange">
          <option value="">—— 请选择单据 ——</option>
          <option v-for="d in docs" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
        <p v-if="metaState === 'error'" class="sub err">{{ metaError }}</p>

        <label class="lbl">目标列（要写入哪一列）</label>
        <ColumnCombo
          v-model="tgtCol"
          :options="tgtCols"
          :disabled="!docId"
          placeholder="搜索自定义字段..."
          :empty-text="docId ? '该单据没有自定义字段' : '请先选择单据'"
        />
        <p class="sub">{{ tgtSub }}</p>

        <div class="clear-row">
          <button class="btn danger" type="button" :disabled="!clearEnabled" @click="onClear">清除目标字段</button>
          <span class="sub">清除当前目标字段的所有非空值，执行前备份</span>
        </div>
      </div>

      <div class="flow-arrow">→</div>

      <div class="paper-card card">
        <div class="step"><b>02</b> 来源</div>

        <label class="lbl">来源档（自动排除已选单据）</label>
        <select v-model="srcId" :disabled="!docId" @change="onSrcChange">
          <option value="">—— 请选择来源档 ——</option>
          <option v-for="s in srcOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>

        <label class="lbl">来源值列（取哪一列的值，可搜索切换）</label>
        <ColumnCombo
          v-model="srcValCol"
          :options="valCols"
          :disabled="!srcId"
          placeholder="先选择来源档，再选来源值列..."
          :empty-text="srcId ? '该来源档没有可选值列' : '请先选择来源档'"
        />
        <p class="sub">{{ valSub }}</p>
      </div>
    </div>

    <div class="paper-card adv">
      <div class="adv-title">高级选项</div>
      <div class="adv-body">
        <label class="chk"><input v-model="force" type="checkbox" /> 强制覆盖</label>
        <label class="chk">
          <input v-model="createTrigger" type="checkbox" :disabled="triggerBlocked" /> 建立触发器
        </label>
        <label class="chk"><input v-model="mergeDisplay" type="checkbox" /> 合并显示</label>
        <span v-if="triggerBlocked" class="sub">付款单身汇总依赖付款冲账档，保存后用「执行」更新</span>
      </div>
    </div>

    <p v-if="message" class="status" :class="messageKind">{{ message }}</p>

    <div class="actionbar">
      <span class="sub">执行前自动备份；强制覆盖 / 触发器 / 合并在高级选项里。</span>
      <div class="btns">
        <button class="btn" type="button" :disabled="running" @click="store.previewNow()">预览</button>
        <button class="btn primary" type="button" :disabled="running || !canPreview" @click="onExecute">
          {{ running ? '执行中...' : '执行' }}
        </button>
      </div>
    </div>

    <div v-if="preview" class="paper-card block">
      <div class="block-head">
        <strong>{{ previewTitle }}</strong>
        <span class="sub">共 {{ preview.totalRows ?? 0 }} 行待填入</span>
      </div>
      <p v-for="(b, i) in banners" :key="i" class="sub warn">{{ b.text }}</p>
      <table v-if="preview.sample && preview.sample.length" class="grid">
        <thead>
          <tr>
            <th>单号</th>
            <th>序号</th>
            <th>现值</th>
            <th>应带</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in preview.sample" :key="i">
            <td>{{ row['单号'] ?? '' }}</td>
            <td>{{ row['序号'] ?? '' }}</td>
            <td>{{ row['现值'] ?? '' }}</td>
            <td>{{ row['应带'] ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="sub">本次没有需要填入的行。</p>
    </div>

    <div v-if="result" class="paper-card block">
      <div class="block-head">
        <strong>执行结果</strong>
        <span class="sub">受影响 {{ result.affected ?? 0 }} 行</span>
      </div>
      <p class="sub">
        备份：<span class="path">{{ result.backupPath || '—' }}</span>
        <template v-if="result.backupOk === false"> （备份失败）</template>
      </p>
      <p v-if="result.triggerResult?.name" class="sub">
        触发器：{{ result.triggerResult.name }}
        <template v-if="result.triggerResult.skipped">（已跳过：冲突 {{ (result.triggerResult.conflict || []).join('、') }}）</template>
        <template v-else-if="result.triggerResult.error">（失败：{{ result.triggerResult.error }}）</template>
      </p>
      <ul v-if="result.sampleAfter && result.sampleAfter.length" class="after">
        <li v-for="(s, i) in result.sampleAfter" :key="i">
          <span>{{ s.docNo ?? '' }}</span>
          <span class="filled">{{ s.filled ?? '' }}</span>
        </li>
      </ul>
      <p class="hint">前台易助需关闭该单后重新查询才会显示新值。</p>
    </div>
  </section>
</template>

<style scoped>
.page {
  padding: 16px 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr);
  align-items: stretch;
  gap: 0;
}

.flow-arrow {
  display: grid;
  place-items: center;
  color: var(--ink-3);
  font-size: 18px;
}

.card {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step {
  font-family: var(--font-title);
  font-size: 15px;
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.step b {
  color: var(--seal);
  margin-right: 6px;
}

.lbl {
  font-size: 12.5px;
  color: var(--ink-2);
  margin-top: 8px;
}

select {
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

select:focus {
  border-color: var(--seal);
}

select:disabled {
  background: var(--wash);
  color: var(--ink-3);
}

.sub {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-3);
}

.clear-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.btn {
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 6px 14px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.btn:hover:not(:disabled) {
  border-color: var(--seal);
  color: var(--seal);
}

.btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.btn.primary {
  background: var(--seal);
  border-color: var(--seal);
  color: #fffaf0;
}

.btn.primary:hover:not(:disabled) {
  background: var(--seal-deep);
  color: #fffaf0;
}

.btn.danger {
  color: var(--seal);
  border-color: var(--seal-wash);
}

.adv {
  padding: 10px 16px;
}

.adv-title {
  font-size: 12.5px;
  color: var(--ink-3);
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.adv-body {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
}

.chk input {
  accent-color: var(--seal);
}

.status {
  margin: 0;
  font-size: 12.5px;
  min-height: 18px;
}

.status.ok {
  color: var(--ok);
}

.status.err {
  color: var(--seal);
}

.err {
  color: var(--seal);
}

.actionbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}

.btns {
  display: flex;
  gap: 10px;
}

.block {
  padding: 12px 16px 14px;
}

.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.grid th,
.grid td {
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line-soft);
}

.grid th {
  color: var(--ink-3);
  font-weight: 500;
}

.warn {
  color: var(--warn);
}

.path {
  color: var(--ink-2);
  word-break: break-all;
}

.after {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--ink-2);
}

.after .filled {
  margin-left: 10px;
  color: var(--seal-deep);
}

.hint {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--seal);
}
</style>
