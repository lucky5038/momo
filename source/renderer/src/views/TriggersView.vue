<script setup lang="ts">
/** 触发器管理（P4）：列表 / 启停 / 删除，行为对齐旧界面「已建立触发器」卡片。
 *  系统触发器只读；删除前后端自动整库备份，所以前端只做一次确认。 */
import { computed, onMounted, ref } from 'vue'
import { useStatus } from '../composables/useStatus'
import { toast } from '../lib/toast'
import { useAppStore } from '../stores/app'
import { listTriggers, toggleTrigger, dropTrigger, type TriggerRow } from '../api/triggers'

const app = useAppStore()
const status = useStatus()
const { text: statusText, kind: statusKind } = status

const rows = ref<TriggerRow[]>([])
const database = ref('')
const server = ref('')
const loading = ref(false)
/** 按触发器名记录忙碌行，避免整页只在「最后点的那行」上有状态 */
const busyRows = ref<Set<string>>(new Set())
/** 刷新序号：并发刷新时只认最后一次结果，避免旧请求把新列表覆盖掉 */
let refreshSeq = 0

const toolRows = computed(() => rows.value.filter((r) => r.isTool))
const sysRows = computed(() => rows.value.filter((r) => !r.isTool))
/** 删除前要告诉用户备份落在哪，这里取系统设置里的实时值 */
const backupDir = computed(() => app.backupDir || '系统设置里未配置')

function isBusy(name: string) {
  return busyRows.value.has(name)
}

function markBusy(name: string, on: boolean) {
  const next = new Set(busyRows.value)
  if (on) next.add(name)
  else next.delete(name)
  busyRows.value = next
}

/** 读列表的唯一实现：quiet=true 时吞掉错误（写操作已成功，刷新失败不该显示成"操作失败"） */
async function loadRows(quiet: boolean) {
  const seq = ++refreshSeq
  if (!quiet) loading.value = true
  try {
    const data = await listTriggers()
    if (seq !== refreshSeq) return
    rows.value = data.triggers || []
    database.value = data.database || ''
    server.value = data.server || ''
  } catch (e) {
    if (seq !== refreshSeq) return
    // 保留上一次的列表：清空会让用户以为"确实没有触发器"
    if (!quiet) status.fail(e)
  } finally {
    if (seq === refreshSeq && !quiet) loading.value = false
  }
}

async function refresh() {
  await loadRows(false)
}

/** 先读列表再提示，避免 refresh() 把刚写的成功提示清掉 */
async function reloadQuiet() {
  await loadRows(true)
}

async function onToggle(row: TriggerRow) {
  if (isBusy(row.name)) return
  markBusy(row.name, true)
  try {
    const r = await toggleTrigger(row.name, row.disabled)
    const done = `已${r.enabled ? '启用' : '停用'} ${row.name}`
    status.set('ok', done)
    toast(done, 'ok')
    await reloadQuiet()
    // reloadQuiet 不写状态，成功提示得以保留
  } catch (e) {
    status.fail(e)
  } finally {
    markBusy(row.name, false)
  }
}

async function onDrop(row: TriggerRow) {
  if (isBusy(row.name)) return
  const ok = window.confirm(
    `确认删除触发器 ${row.name}？\n删除前会自动整库备份到：\n${backupDir.value}`,
  )
  if (!ok) return
  markBusy(row.name, true)
  try {
    const r = await dropTrigger(row.name)
    status.set('ok', `已删除 ${row.name}（备份 ${r.backupPath}）`)
    toast(`已删除 ${row.name}`, 'ok')
    await reloadQuiet()
  } catch (e) {
    status.fail(e)
  } finally {
    markBusy(row.name, false)
  }
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <div class="bar">
      <span class="where" title="触发器属于当前账套，切换账套后要重新刷新">
        账套 <b>{{ database || '---' }}</b> · 服务器 {{ server || '---' }}
      </span>
      <button class="btn" type="button" :disabled="loading" @click="refresh">
        {{ loading ? '刷新中…' : '刷新列表' }}
      </button>
    </div>

    <p v-if="statusText" class="status" :class="statusKind" role="status" aria-live="polite">{{ statusText }}</p>

    <section class="card">
      <p class="step"><b>01</b>本工具触发器</p>
      <p class="sub">新建单据时自动把来源列带进目标列；停用后不再生效，可随时再启用。</p>
      <table v-if="toolRows.length" class="tbl">
        <thead>
          <tr>
            <th class="c-name">名称 / 作用</th>
            <th class="c-tbl">挂载表</th>
            <th class="c-state">状态</th>
            <th class="c-act">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in toolRows" :key="row.name">
            <td class="c-name">
              <b>{{ row.name }}</b>
              <span class="desc">{{ row.desc }}</span>
            </td>
            <td class="c-tbl mono">{{ row.tbl }}</td>
            <td class="c-state">
              <span class="badge" :class="row.disabled ? 'off' : 'on'">
                {{ row.disabled ? '已停用' : '启用中' }}
              </span>
            </td>
            <td class="c-act">
              <button class="btn sm" type="button" :disabled="isBusy(row.name)" @click="onToggle(row)">
                {{ row.disabled ? '启用' : '停用' }}
              </button>
              <button class="btn sm danger" type="button" :disabled="isBusy(row.name)" @click="onDrop(row)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="loading" class="sub">正在读取触发器…</p>
      <p v-else class="sub">当前账套还没有本工具建立的触发器。</p>
    </section>

    <section v-if="sysRows.length" class="card">
      <details>
        <summary class="step sum"><b>02</b>系统触发器（{{ sysRows.length }} 个 · 只读）</summary>
        <p class="sub">ERP 自带的触发器，本工具不会改动它们。</p>
        <table class="tbl">
          <thead>
            <tr>
              <th class="c-name">名称 / 作用</th>
              <th class="c-tbl">挂载表</th>
              <th class="c-state">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sysRows" :key="row.name">
              <td class="c-name">
                <b>{{ row.name }}</b>
                <span class="desc">{{ row.desc }}</span>
              </td>
              <td class="c-tbl mono">{{ row.tbl }}</td>
              <td class="c-state">
                <span class="badge" :class="row.disabled ? 'off' : 'on'">
                  {{ row.disabled ? '已停用' : '启用中' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  </div>
</template>

<style scoped>
.page {
  padding: 12px 0 26px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.where {
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

.where b {
  color: var(--ink-2);
  font-weight: 600;
}

.card {
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px 16px 16px;
}

.step {
  margin: 0 0 4px;
  font-size: var(--fs-section);
  font-weight: 600;
  letter-spacing: normal;
}

.step b {
  color: var(--ink-3);
  margin-right: 6px;
}

.sum {
  cursor: pointer;
  margin-bottom: 6px;
}

.sub {
  margin: 0 0 10px;
  font-size: var(--fs-sub);
  color: var(--ink-3);
}

.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-body);
}

.tbl th {
  text-align: left;
  font-weight: 500;
  font-size: var(--fs-kicker);
  color: var(--ink-3);
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}

.tbl td {
  padding: 8px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: top;
}

.tbl tr:last-child td {
  border-bottom: none;
}

.c-name {
  width: 46%;
}

.c-name b {
  font-weight: 600;
}

.desc {
  display: block;
  margin-top: 2px;
  font-size: var(--fs-sub);
  color: var(--ink-3);
}

.mono {
  font-family: Consolas, 'Courier New', monospace;
  font-size: var(--fs-xs);
  color: var(--ink-2);
}

.c-state {
  width: 90px;
}

.c-act {
  width: 130px;
  white-space: nowrap;
}

.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: var(--fs-kicker);
}

.badge.on {
  color: var(--ok);
  background: var(--ok-wash);
}

.badge.off {
  color: var(--warn);
  background: var(--warn-wash);
}

.btn {
  font-family: inherit;
  font-size: var(--fs-sub);
  color: var(--ink-2);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 5px 12px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  border-color: var(--seal);
  color: var(--seal);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn.sm {
  padding: 3px 10px;
  font-size: var(--fs-xs);
  margin-right: 6px;
}

.btn.danger {
  color: var(--seal);
  border-color: var(--seal-line);
}

.status {
  margin: 0;
  font-size: var(--fs-sub);
}

.status.ok {
  color: var(--ok);
}

.status.err {
  color: var(--err);
}
</style>
