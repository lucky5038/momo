<script setup lang="ts">
/** 首次使用向导（对齐旧界面 onboardWelcomeModal + setupScreen）。
 *  只有后端 GET /api/onboarding 返回 needsSetup=true（本机还没配过数据库）时才出现，
 *  老用户升级不会被打扰。 */
import { reactive, ref } from 'vue'
import { api } from '../api/client'
import { errorMessage } from '../lib/error'

const emit = defineEmits<{ (e: 'done'): void }>()

const step = ref<'welcome' | 'form'>('welcome')
const form = reactive({ server: '127.0.0.1', user: 'sa', password: '', database: '' })
const databases = ref<string[]>([])
const loading = ref(false)
const error = ref('')

async function loadDatabases() {
  error.value = ''
  if (!form.server.trim()) {
    error.value = '请先填写服务器地址；连本机请填 127.0.0.1 或 .'
    return
  }
  loading.value = true
  try {
    const data = await api.databases({
      server: form.server.trim(),
      user: form.user.trim(),
      password: form.password,
    })
    databases.value = (data.databases || []).map((d) => d.name)
    if (!databases.value.length) error.value = '这台服务器上没读到账套，请确认账号权限'
    else if (!databases.value.includes(form.database)) form.database = databases.value[0]
  } catch (e) {
    databases.value = []
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

async function finish() {
  error.value = ''
  if (!form.server.trim() || !form.user.trim()) {
    error.value = '服务器和账号都要填'
    return
  }
  if (!form.database) {
    error.value = '请先点「读取账套」选一个账套'
    return
  }
  loading.value = true
  try {
    await api.saveConfig({
      server: form.server.trim(),
      user: form.user.trim(),
      password: form.password,
      database: form.database,
    })
    try {
      await api.saveCreds({ [form.server.trim()]: { user: form.user.trim(), pass: form.password } })
    } catch {
      /* 凭据写不进不影响进入软件 */
    }
    await api.finishOnboarding()
    emit('done')
    // 配置变了，整体重启渲染层最省事（旧界面同样 location.reload）
    location.reload()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="gate">
    <div class="wizard" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <template v-if="step === 'welcome'">
        <p class="kicker">第一次使用</p>
        <h2 id="ob-title">先把数据库连上</h2>
        <p class="sub">
          连上之后会自动读取账套与单据字典。配置只写在本机
          <code>config.js</code>，不会上传到任何地方。
        </p>
        <ul class="points">
          <li><b>服务器</b><span>ERP 数据库所在机器，本机就填 127.0.0.1</span></li>
          <li><b>账号</b><span>SQL Server 登录名，一般用 sa</span></li>
          <li><b>账套</b><span>连上后从列表里选，例如 DSB、XBK</span></li>
        </ul>
        <div class="actions">
          <button class="btn primary" type="button" @click="step = 'form'">开始设置</button>
        </div>
      </template>

      <template v-else>
        <p class="kicker">数据库连接</p>
        <h2 id="ob-title">填写连接信息</h2>
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
            <input v-model="form.password" class="mono" type="password" autocomplete="off" />
          </label>
          <div class="field wide">
            <span class="lbl">账套</span>
            <div class="db-row">
              <select v-model="form.database" :disabled="loading || !databases.length">
                <option value="">请先读取账套</option>
                <option v-for="d in databases" :key="d" :value="d">{{ d }}</option>
              </select>
              <button class="btn sm" type="button" :disabled="loading" @click="loadDatabases">
                {{ loading ? '读取中…' : '读取账套' }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="error" class="err">{{ error }}</p>
        <div class="actions">
          <button class="btn sm" type="button" :disabled="loading" @click="step = 'welcome'">上一步</button>
          <button class="btn primary" type="button" :disabled="loading" @click="finish">
            {{ loading ? '保存中…' : '保存并进入软件' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--paper);
}

.wizard {
  width: 100%;
  max-width: 620px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-pop);
  padding: 22px 24px 20px;
}

.kicker {
  margin: 0 0 6px;
  font-size: var(--fs-kicker);
  font-weight: 600;
  letter-spacing: 1.2px;
  color: var(--seal);
}

h2 {
  margin: 0 0 10px;
  font-size: var(--fs-page-title);
  font-weight: 700;
  letter-spacing: normal;
}

.sub {
  margin: 0 0 14px;
  font-size: var(--fs-sub);
  color: var(--ink-2);
  line-height: 1.7;
}

.sub code {
  font-family: var(--font-mono, ui-monospace, Consolas, monospace);
  background: var(--wash);
  padding: 1px 4px;
  border-radius: 3px;
}

.points {
  margin: 0 0 16px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.points li {
  display: flex;
  gap: 10px;
  font-size: var(--fs-sub);
  color: var(--ink-2);
}

.points b {
  flex: none;
  width: 52px;
  color: var(--ink);
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 14px;
  margin-bottom: 10px;
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
  font-size: var(--fs-sub);
  color: var(--ink-2);
}

input,
select {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  font-family: inherit;
  font-size: var(--fs-body);
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

input:focus,
select:focus {
  outline: none;
  border-color: var(--seal);
}

.db-row {
  display: flex;
  gap: 8px;
}

.err {
  margin: 0 0 10px;
  font-size: var(--fs-sub);
  color: var(--err);
  line-height: 1.6;
}

.wizard :deep(.btn),
.actions .btn {
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
</style>
