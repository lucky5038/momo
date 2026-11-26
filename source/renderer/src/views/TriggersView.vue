<script setup lang="ts">
/** 触发器管理（P4）：列表 / 启停 / 删除，行为对齐旧界面「已建立触发器」卡片。
 *  系统触发器只读；删除前后端自动整库备份，所以前端只做一次确认。 */
import { computed, onMounted, ref } from 'vue'
import { ApiError } from '../api/client'
import { listTriggers, toggleTrigger, dropTrigger, type TriggerRow } from '../api/triggers'

const rows = ref<TriggerRow[]>([])
const database = ref('')
const server = ref('')
const loading = ref(false)
const busy = ref('')
const message = ref('')
const messageKind = ref<'' | 'ok' | 'err'>('')

const toolRows = computed(() => rows.value.filter((r) => r.isTool))
const sysRows = computed(() => rows.value.filter((r) => !r.isTool))

function setMessage(text: string, kind: 'ok' | 'err' | '') {
  message.value = text
  messageKind.value = kind
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return e instanceof Error ? e.message : String(e)
}

async function refresh() {
  loading.value = true
  setMessage('', '')
  try {
    const data = await listTriggers()
    rows.value = data.triggers || []
    database.value = data.database || ''
    server.value = data.server || ''
  } catch (e) {
    rows.value = []
    setMessage(errorText(e), 'err')
  } finally {
    loading.value = false
  }
}

async function onToggle(row: TriggerRow) {
  busy.value = row.name
  try {
    const enable = row.disabled
    const r = await toggleTrigger(row.name, enable)
    setMessage(`已${r.enabled ? '启用' : '停用'} ${row.name}`, 'ok')
    await refresh()
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
  }
}

async function onDrop(row: TriggerRow) {
  const ok = window.confirm(
    `确认删除触发器 ${row.name}？\n删除前会自动整库备份（备份目录见系统设置）。`,
  )
  if (!ok) return
  busy.value = row.name
  try {
    const r = await dropTrigger(row.name)
    setMessage(`已删除 ${row.name}（备份 ${r.backupPath}）`, 'ok')
    await refresh()
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
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

    <p v-if="message" class="status" :class="messageKind">{{ message }}</p>

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
              <button class="btn sm" type="button" :disabled="busy === row.name" @click="onToggle(row)">
                {{ row.disabled ? '启用' : '停用' }}
              </button>
              <button class="btn sm danger" type="button" :disabled="busy === row.name" @click="onDrop(row)">
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
  font-size: 12px;
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
  font-family: var(--font-title);
  font-size: 15px;
  letter-spacing: 1px;
}

.step b {
  color: var(--seal);
  margin-right: 6px;
}

.sum {
  cursor: pointer;
  margin-bottom: 6px;
}

.sub {
  margin: 0 0 10px;
  font-size: 11.5px;
  color: var(--ink-3);
}

.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.tbl th {
  text-align: left;
  font-weight: 500;
  font-size: 11.5px;
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
  font-size: 11.5px;
  color: var(--ink-3);
}

.mono {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
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
  font-size: 11.5px;
}

.badge.on {
  color: var(--ok);
  background: rgba(63, 122, 94, 0.1);
}

.badge.off {
  color: var(--warn);
  background: rgba(180, 105, 46, 0.1);
}

.btn {
  font-family: inherit;
  font-size: 12.5px;
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
  font-size: 12px;
  margin-right: 6px;
}

.btn.danger {
  color: var(--seal);
  border-color: rgba(168, 50, 45, 0.35);
}

.status {
  margin: 0;
  font-size: 12.5px;
}

.status.ok {
  color: var(--ok);
}

.status.err {
  color: var(--err);
}
</style>
