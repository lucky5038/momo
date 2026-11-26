<script setup lang="ts">
/** 跨表带值（P2）：01 目标 → 02 来源 → 高级选项 → 预览/执行。
 *  行为对齐旧界面 #tab-sync，差异只在"切单据/来源会清空旧结果"这一处（旧版会残留）。 */
import { computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import ColumnCombo from '../components/ColumnCombo.vue'
import { useAppStore } from '../stores/app'
import { useCrossFillStore } from '../stores/crossfill'

const app = useAppStore()
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
  previewing,
  executing,
  busy,
  defaultValCol,
  chainLabels,
  chainPathIndex,
  chainLoading,
  hasMultiChain,
  chainHint,
  result,
  message,
  messageKind,
  metaState,
  metaError,
} = storeToRefs(store)

onMounted(() => {
  if (!docs.value.length) store.loadMeta()
})

// 账套/服务器切换后字典必须重拉，否则会拿旧账套的列去写新库
watch(
  () => app.generation,
  () => {
    store.invalidate()
    void store.loadMeta()
  },
)

/** 旧界面把 info=true 的单据放进「信息档」分组，这里保持同样的分组方式 */
const docGroups = computed(() => ({
  normal: docs.value.filter((d) => !d.info),
  info: docs.value.filter((d) => d.info),
}))
const srcGroups = computed(() => ({
  normal: srcOptions.value.filter((s) => !s.info),
  info: srcOptions.value.filter((s) => s.info),
}))

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
  if (!docId.value) return '请先选择单据'
  if (!srcId.value) return srcOptions.value.length ? '请先选择来源档' : '当前单据没有可选来源档'
  const hint = defaultValCol.value ? `（默认关联 ${defaultValCol.value}）` : ''
  return `共 ${valCols.value.length} 个可选值列${hint}`
})

const previewTitle = computed(() => {
  if (!preview.value) return ''
  const d = curDoc.value
  return `目标 ${d ? `${d.sub}.${tgtCol.value}` : tgtCol.value} ← 来源 ${srcId.value}.${srcValCol.value}`
})

const banners = computed(() => {
  const p = preview.value
  if (!p) return [] as { kind: 'warn' | 'note'; text: string }[]
  const list: { kind: 'warn' | 'note'; text: string }[] = []
  // 类型不匹配 / 链条提示属于风险项，用告警色；其余是说明
  if (p.typeWarning) list.push({ kind: 'warn', text: p.typeWarning })
  if (p.chainWarning) list.push({ kind: 'warn', text: p.chainWarning })
  // 本次实际走的链路：多链路时让用户看清用了哪条，而不是"莫名其妙多带了值"
  if (p.chainPaths && p.chainPaths.length) {
    list.push({ kind: 'note', text: `本次链路：${p.chainPaths.join('；')}` })
  }
  if (p.mergeNote) list.push({ kind: 'note', text: p.mergeNote })
  if (p.partyNote) list.push({ kind: 'note', text: p.partyNote })
  if (p.note) list.push({ kind: 'note', text: p.note })
  return list
})

/** 空结果也要解释清楚，否则用户会以为工具坏了（旧界面按合并显示分两套文案） */
const emptyHint = computed(() => {
  if (!preview.value) return ''
  if (mergeDisplay.value) {
    return '源值为空、或来源档与目标单据没有匹配的行。合并显示只追加不覆盖，可先确认来源档与值列。'
  }
  return force.value
    ? '源值为空、或来源档与目标单据没有匹配的行。'
    : '源值为空、或该列已经有值（数值 0 也算已有值）。需要覆盖已有值请勾选「强制覆盖」。'
})

/** 后端预览只回 50 行样本，命中更多时必须说明，否则用户会以为只写了这些 */
const sampleNote = computed(() => {
  const p = preview.value
  if (!p) return ''
  const total = Number(p.totalRows || 0)
  const shown = p.sample?.length ?? 0
  if (!total || shown >= total) return ''
  return `预览只列前 ${shown} 行样本，实际会写入 ${total} 行；执行前建议先看一眼备份目录。`
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

        <label class="lbl" for="cf-doc">目标单据（主表）</label>
        <select id="cf-doc" v-model="docId" :disabled="!docs.length" :title="docSub" @change="onDocChange">
          <option value="">—— 请选择单据 ——</option>
          <optgroup v-if="docGroups.normal.length" label="业务单据">
            <option v-for="d in docGroups.normal" :key="d.id" :value="d.id">{{ d.name }}</option>
          </optgroup>
          <optgroup v-if="docGroups.info.length" label="信息档">
            <option v-for="d in docGroups.info" :key="d.id" :value="d.id">{{ d.name }}</option>
          </optgroup>
        </select>
        <p v-if="metaState === 'error'" class="sub err">{{ metaError }}</p>

        <label class="lbl">目标列（要写入哪一列）</label>
        <ColumnCombo
          :model-value="tgtCol"
          :options="tgtCols"
          @update:model-value="store.setTgtCol"
          :disabled="!docId"
          placeholder="搜索自定义字段..."
          :empty-text="docId ? '该单据没有自定义字段' : '请先选择单据'"
        />
        <p class="sub">{{ tgtSub }}</p>

        <div class="clear-row">
          <button class="btn danger" type="button" :disabled="!clearEnabled || busy" @click="onClear">清除目标字段</button>
          <span class="sub">清除当前目标字段的所有非空值，执行前备份</span>
        </div>
      </div>

      <div class="flow-arrow">→</div>

      <div class="paper-card card">
        <div class="step"><b>02</b> 来源</div>

        <label class="lbl" for="cf-src">来源档（自动排除已选单据）</label>
        <select id="cf-src" v-model="srcId" :disabled="!docId" @change="onSrcChange">
          <option value="">—— 请选择来源档 ——</option>
          <optgroup v-if="srcGroups.normal.length" label="业务单据">
            <option v-for="s in srcGroups.normal" :key="s.id" :value="s.id">{{ s.name }}</option>
          </optgroup>
          <optgroup v-if="srcGroups.info.length" label="信息档">
            <option v-for="s in srcGroups.info" :key="s.id" :value="s.id">{{ s.name }}</option>
          </optgroup>
        </select>
        <p v-if="docId && !srcOptions.length" class="sub">当前单据没有可选来源档</p>

        <label class="lbl">来源值列（取哪一列的值，可搜索切换）</label>
        <ColumnCombo
          :model-value="srcValCol"
          :options="valCols"
          @update:model-value="store.setSrcValCol"
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
        <label class="chk"><input v-model="force" type="checkbox" @change="store.clearRunState()" /> 强制覆盖</label>
        <label class="chk">
          <input v-model="createTrigger" type="checkbox" :disabled="triggerBlocked" @change="store.clearRunState()" /> 建立触发器
        </label>
        <label class="chk"><input v-model="mergeDisplay" type="checkbox" @change="store.clearRunState()" /> 合并显示</label>
        <span v-if="triggerBlocked" class="sub">付款单身汇总依赖付款冲账档，保存后用「执行」更新</span>
      </div>
      <div v-if="srcId && (chainLoading || chainLabels.length)" class="chain-row">
        <label class="lbl" for="cf-chain">取值链路</label>
        <select
          id="cf-chain"
          :value="String(chainPathIndex)"
          :disabled="busy || !hasMultiChain"
          @change="store.setChainPath(Number(($event.target as HTMLSelectElement).value))"
        >
          <option value="-1">{{ hasMultiChain ? '自动（默认，合并全部链路）' : '自动（当前只有一条链路）' }}</option>
          <option v-for="(label, i) in chainLabels" :key="label" :value="String(i)">{{ label }}</option>
        </select>
        <span class="sub">{{ chainHint }}</span>
      </div>
    </div>

    <p v-if="message" class="status" :class="messageKind" role="status" aria-live="polite">{{ message }}</p>

    <div class="actionbar">
      <span class="sub">执行前自动备份；强制覆盖 / 触发器 / 合并在高级选项里。</span>
      <div class="btns">
        <button class="btn" type="button" :disabled="busy" @click="store.previewNow()">
          {{ previewing ? '预览中...' : '预览' }}
        </button>
        <button class="btn primary" type="button" :disabled="busy || !canPreview" @click="onExecute">
          {{ executing ? '执行中...' : '执行' }}
        </button>
      </div>
    </div>

    <div v-if="preview" class="paper-card block">
      <div class="block-head">
        <strong>{{ previewTitle }}</strong>
        <span class="sub">共 {{ preview.totalRows ?? 0 }} 行待填入</span>
      </div>
      <p v-for="b in banners" :key="b.text" class="sub" :class="b.kind">{{ b.text }}</p>
      <p v-if="sampleNote" class="sub">{{ sampleNote }}</p>
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
          <tr v-for="(row, i) in preview.sample" :key="(row['单号'] || '') + '#' + (row['序号'] || i)">
            <td>{{ row['单号'] ?? '—' }}</td>
            <td>{{ row['序号'] ?? '—' }}</td>
            <td>{{ row['现值'] ?? '—' }}</td>
            <td>{{ row['应带'] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <template v-else><p class="sub">本次没有需要填入的行。</p><p class="sub">{{ emptyHint }}</p></template>
    </div>

    <div v-if="result" class="paper-card block">
      <div class="block-head">
        <strong>已写入数据库</strong>
        <span class="sub">受影响 {{ result.affected ?? 0 }} 行</span>
      </div>
      <p class="sub">
        备份：<span class="path">{{ result.backupPath || '—' }}</span>
      </p>
      <template v-if="result.triggerResult?.name">
        <p v-if="result.triggerResult.error" class="sub err">
          触发器创建失败：{{ result.triggerResult.error }}
        </p>
        <p v-else-if="result.triggerResult.skipped" class="sub">
          触发器未创建：目标表上已有写入该列的触发器
          <template v-if="result.triggerResult.conflict && result.triggerResult.conflict.length">
            （冲突 {{ result.triggerResult.conflict.join('、') }}）
          </template>
        </p>
        <p v-else class="sub ok">触发器已创建：{{ result.triggerResult.name }}</p>
      </template>
      <p v-if="result.triggerResult?.skipped && result.triggerResult?.allowForce" class="sub">
        勾选「强制覆盖」可忽略此冲突并强制创建。
      </p>
      <p v-if="result.triggerResult?.conflictNote" class="sub">{{ result.triggerResult.conflictNote }}</p>
      <template v-if="result.sampleAfter && result.sampleAfter.length">
        <p class="sub">执行后抽样（前 {{ result.sampleAfter.length }} 行）：</p>
        <ul class="after">
          <li v-for="(s, i) in result.sampleAfter" :key="(s.docNo || '') + '#' + i">
            <span>{{ s.docNo ?? '' }}</span>
            <span class="filled">{{ s.filled ?? '' }}</span>
          </li>
        </ul>
      </template>
      <p class="hint">前台易助需关闭该单后重新查询才会显示新值。</p>
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
  font-size: var(--fs-card);
}

.card {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step {
  font-size: var(--fs-section);
  font-weight: 600;
  letter-spacing: normal;
  margin-bottom: 4px;
}

.step b {
  color: var(--ink-3);
  margin-right: 6px;
}

.lbl {
  font-size: var(--fs-sub);
  color: var(--ink-2);
  margin-top: 8px;
}

select {
  width: 100%;
  font-family: inherit;
  font-size: var(--fs-body);
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
  font-size: var(--fs-sub);
  color: var(--ink-3);
}

.sub
.clear-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}


.adv {
  padding: 10px 16px;
}

.adv-title {
  font-size: var(--fs-sub);
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
  font-size: var(--fs-sub);
  color: var(--ink-2);
  cursor: pointer;
}

/* 取值链路：多链路才需要选，单条时只显示"自动" */
.chain-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--line-soft);
}

.chain-row .lbl {
  margin: 0;
}

.chain-row select {
  max-width: 460px;
}

.chk input {
  accent-color: var(--seal);
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
  font-size: var(--fs-xs);
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


.path {
  color: var(--ink-2);
  word-break: break-all;
}

.after {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: var(--fs-xs);
  color: var(--ink-2);
}

.after .filled {
  margin-left: 10px;
  color: var(--seal-deep);
}

.hint {
  margin: 8px 0 0;
  font-size: var(--fs-kicker);
  color: var(--seal);
}
</style>
