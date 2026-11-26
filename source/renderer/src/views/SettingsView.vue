<script setup lang="ts">
/** 系统设置（P5）：数据库连接 / 账套切换 / 备份路径。
 *  契约来自 app.js：GET /api/config、POST /api/save-config、POST /api/test-conn、
 *  POST /api/databases、POST /api/switch-db、GET|POST /api/backup-dir。
 *  注意：/api/test-conn 成功后后端会直接把新参数落盘并切库（dryRun 除外），所以这里不再单独保存。 */
import { onMounted, reactive, ref } from 'vue'
import { ApiError, api } from '../api/client'
import { useAppStore } from '../stores/app'

const app = useAppStore()

const form = reactive({
  server: '',
  user: '',
  password: '',
  database: '',
})

const databases = ref<string[]>([])
const backupDir = ref('')
const showPass = ref(false)
const loading = ref(true)
const busy = ref<'' | 'test' | 'save' | 'dbs' | 'switch' | 'backup'>('')
const message = ref('')
const messageKind = ref<'' | 'ok' | 'err'>('')

function setMessage(text: string, kind: 'ok' | 'err' | '') {
  message.value = text
  messageKind.value = kind
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return e instanceof Error ? e.message : String(e)
}

async function load() {
  loading.value = true
  try {
    const cfg = await api.config()
    form.server = cfg.server || ''
    form.user = cfg.user || ''
    form.password = cfg.password || ''
    form.database = cfg.database || ''
    backupDir.value = cfg.backupDir || ''
    await loadDatabases(true)
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    loading.value = false
  }
}

async function loadDatabases(quiet = false) {
  if (!form.server && !form.user) return
  busy.value = 'dbs'
  try {
    const data = await api.databases({
      server: form.server,
      user: form.user,
      password: form.password,
    })
    databases.value = (data.databases || []).map((d) => d.name)
    if (form.database && !databases.value.includes(form.database)) {
      databases.value.unshift(form.database)
    }
    if (!quiet) setMessage(`已读取 ${databases.value.length} 个账套`, 'ok')
  } catch (e) {
    if (!quiet) setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
  }
}

async function onSwitchDb() {
  if (!form.database) return
  busy.value = 'switch'
  try {
    await api.switchDb(form.database)
    await app.checkConnection()
    // 切库后字典会整体换一套，跨表带值那边要重新拉
    setMessage(`已切换到账套 ${form.database}`, 'ok')
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
  }
}

async function onTest() {
  busy.value = 'test'
  setMessage('正在连接…', '')
  try {
    await api.testConn({
      server: form.server,
      user: form.user,
      password: form.password,
      database: form.database,
    })
    await app.checkConnection()
    setMessage('连接成功，已应用当前参数', 'ok')
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
  }
}

async function onSave() {
  if (!form.server.trim()) {
    setMessage('服务器地址不能为空；连本机请填 127.0.0.1 或 .', 'err')
    return
  }
  if (!form.user.trim()) {
    setMessage('账号不能为空', 'err')
    return
  }
  busy.value = 'save'
  try {
    await api.saveConfig({
      server: form.server.trim(),
      user: form.user.trim(),
      password: form.password,
      database: form.database,
    })
    await app.checkConnection()
    setMessage('配置已保存到 config.js', 'ok')
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
  }
}

async function onChangeBackupDir() {
  busy.value = 'backup'
  try {
    const r = await api.setBackupDir()
    if (r.canceled) {
      setMessage('已取消选择', '')
      return
    }
    backupDir.value = r.backupDir || backupDir.value
    setMessage('备份路径已更新', 'ok')
  } catch (e) {
    setMessage(errorText(e), 'err')
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <p v-if="message" class="status" :class="messageKind">{{ message }}</p>

    <section class="card">
      <p class="step"><b>01</b>数据库连接</p>
      <div class="grid">
        <label class="field">
          <span class="lbl">服务器</span>
          <input v-model="form.server" class="mono" placeholder="如 127.0.0.1" autocomplete="off" />
        </label>
        <label class="field">
          <span class="lbl">账号</span>
          <input v-model="form.user" class="mono" autocomplete="off" />
        </label>
        <label class="field">
          <span class="lbl">密码</span>
          <span class="pass">
            <input
              v-model="form.password"
              class="mono"
              :type="showPass ? 'text' : 'password'"
              autocomplete="off"
            />
            <button class="pass-toggle" type="button" @click="showPass = !showPass">
              {{ showPass ? '隐藏' : '显示' }}
            </button>
          </span>
        </label>
        <label class="field wide">
          <span class="lbl">账套（数据库）</span>
          <span class="db-row">
            <select v-model="form.database" :disabled="busy === 'switch'" @change="onSwitchDb">
              <option value="">请选择账套</option>
              <option v-for="d in databases" :key="d" :value="d">{{ d }}</option>
            </select>
            <button class="btn sm" type="button" :disabled="busy === 'dbs'" @click="loadDatabases(false)">
              {{ busy === 'dbs' ? '读取中…' : '刷新' }}
            </button>
          </span>
        </label>
      </div>
      <div class="actions">
        <button class="btn sm" type="button" :disabled="busy === 'test'" @click="onTest">
          {{ busy === 'test' ? '连接中…' : '测试连接' }}
        </button>
        <button class="btn sm" type="button" :disabled="busy === 'save'" @click="onSave">
          {{ busy === 'save' ? '保存中…' : '保存配置' }}
        </button>
        <span class="sub">测试连接成功后会自动应用并落盘，不需要再点保存。</span>
      </div>
    </section>

    <section class="card">
      <p class="step"><b>02</b>备份路径</p>
      <p class="sub">执行带值、删除触发器前的整库备份都写在这里。</p>
      <div class="backup-row">
        <span class="dir mono" :title="backupDir">{{ backupDir || '尚未设置' }}</span>
        <button class="btn sm" type="button" :disabled="busy === 'backup'" @click="onChangeBackupDir">
          {{ busy === 'backup' ? '请选择目录…' : '更改路径' }}
        </button>
      </div>
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

.card {
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px 16px 16px;
}

.step {
  margin: 0 0 10px;
  font-size: var(--fs-section);
  font-weight: 600;
  letter-spacing: normal;
}

.step b {
  color: var(--ink-3);
  margin-right: 6px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field.wide {
  grid-column: 1 / -1;
}

.lbl {
  font-size: 12.5px;
  color: var(--ink-2);
}

input,
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

input:focus,
select:focus {
  border-color: var(--seal);
}

.mono {
  font-family: Consolas, 'Courier New', monospace;
}

.pass {
  position: relative;
  display: block;
}

.pass input {
  padding-right: 52px;
}

.pass-toggle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-family: inherit;
  font-size: 11.5px;
  color: var(--ink-3);
  background: transparent;
  border: none;
  padding: 2px 6px;
  cursor: pointer;
}

.pass-toggle:hover {
  color: var(--seal);
}

.db-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.backup-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dir {
  flex: 1;
  font-size: 12.5px;
  color: var(--ink-2);
  background: var(--wash);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  padding: 6px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-3);
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
  white-space: nowrap;
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
  padding: 5px 12px;
  font-size: 12.5px;
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
