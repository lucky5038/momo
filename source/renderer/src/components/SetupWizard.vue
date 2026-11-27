<script setup lang="ts">
/**
 * 首次使用向导：三步（欢迎 → 实施十步 → 连接数据库）
 * 只做渲染与表单，所有数据都走后端既有接口；保存后 reload 进入主界面。
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { errorMessage } from '../lib/error'
import { APP_VERSION } from '../config/app'
import appIcon from '../assets/app-icon.png'

type Step = 1 | 2 | 3

interface ImplStep {
  n: string
  name: string
  tag?: string
  plan?: boolean
}

/** 易助十大实施步骤（tag 为「工具在这段里能做什么」，没有 tag 的表示纯人工） */
const IMPL_STEPS: ImplStep[] = [
  { n: '01', name: '启动' },
  { n: '02', name: '安装', tag: '安装系统' },
  { n: '03', name: '编码', tag: '规划中', plan: true },
  { n: '04', name: '调研', tag: '流程调研' },
  { n: '05', name: '培训', tag: '流程培训' },
  { n: '06', name: '模拟', tag: '规划中', plan: true },
  { n: '07', name: '期初', tag: '规划中', plan: true },
  { n: '08', name: '上线会议', tag: '会议决策' },
  { n: '09', name: '检查', tag: '规划中', plan: true },
  { n: '10', name: '结案' },
]

const NOTES = [
  {
    title: '03 编码 · 跨表带值（规划中）',
    body: '建档、编码规则、辅助资料先试着带值：选两张单据一列来源，路由工具算，执行前整库备份。',
  },
  {
    title: '07 期初 · 数据清洗导入（规划中）',
    body: '客户 Excel 匹配模板、校验必填、生成可导入 XLS；固定资产/商品/单位等 19 套模板还在打磨。',
  },
  {
    title: '09 检查 · 数据体检（刚起头）',
    body: '想查字段字典、空值与映射完整性；上线对账、差异定位还远没到能交给工具的程度。',
  },
]

const step = ref<Step>(1)
const server = ref('127.0.0.1')
const user = ref('sa')
const password = ref('')
const database = ref('')
const databases = ref<string[]>([])
const busy = ref<'' | 'db' | 'save'>('')
const message = ref('')
const messageKind = ref<'' | 'ok' | 'err'>('')

const planCount = computed(() => IMPL_STEPS.filter((s) => s.plan).length)
/** 进度点用：避开 v-if 收窄导致的类型比较报错 */
const stepNo = computed(() => Number(step.value))

const canSave = computed(
  () => server.value.trim().length > 0 && user.value.trim().length > 0 && database.value.trim().length > 0,
)

onMounted(async () => {
  try {
    const cfg = await api.config()
    if (cfg?.server) server.value = cfg.server
    if (cfg?.user) user.value = cfg.user
  } catch {
    /* 首次安装没有配置属于正常情况 */
  }
})

function go(next: Step) {
  message.value = ''
  messageKind.value = ''
  step.value = next
}

function setMessage(kind: '' | 'ok' | 'err', text: string) {
  messageKind.value = kind
  message.value = text
}

async function loadDatabases() {
  if (busy.value) return
  if (!server.value.trim() || !user.value.trim()) {
    setMessage('err', '先填服务器和账号，再读取账套。')
    return
  }
  busy.value = 'db'
  setMessage('', '')
  try {
    const r = await api.databases({ server: server.value.trim(), user: user.value.trim(), password: password.value })
    const list = (r.databases || []).map((d) => d.name).filter(Boolean)
    databases.value = list
    if (!list.length) {
      setMessage('err', '连上了，但这个账号看不到账套。')
    } else {
      if (!list.includes(database.value)) database.value = r.currentDb && list.includes(r.currentDb) ? r.currentDb : list[0]
      setMessage('ok', `已读取 ${list.length} 个账套。`)
    }
  } catch (e) {
    databases.value = []
    setMessage('err', errorMessage(e) || '读取账套失败，检查服务器/账号/密码。')
  } finally {
    busy.value = ''
  }
}

async function save() {
  if (busy.value) return
  if (!canSave.value) {
    setMessage('err', '服务器、账号、账套都要填。')
    return
  }
  busy.value = 'save'
  setMessage('', '')
  try {
    await api.saveConfig({ server: server.value.trim(), user: user.value.trim(), password: password.value, database: database.value })
    await api.saveCreds({ [server.value.trim()]: { user: user.value.trim(), pass: password.value } })
    await api.finishOnboarding()
    location.reload()
  } catch (e) {
    setMessage('err', errorMessage(e) || '保存失败。')
    busy.value = ''
  }
}
</script>

<template>
  <div class="wizard">
    <div class="grain" aria-hidden="true"></div>
    <div class="ink i1" aria-hidden="true"></div>
    <div class="ink i2" aria-hidden="true"></div>

    <header class="wz-head">
      <div class="brand">
        <img class="mark" :src="appIcon" alt="N-B助手" />
        <div>
          <div class="bname">N-B助手</div>
          <div class="bsub">实施流程优化</div>
        </div>
      </div>
      <div v-if="step === 1" class="kicker"><i></i>第一次使用</div>
      <div v-else class="progress" aria-hidden="true">
        <b :class="{ on: stepNo === 1 }">01</b><i></i>
        <b :class="{ on: stepNo === 2 }">02</b><i></i>
        <b :class="{ on: stepNo === 3 }">03</b>
      </div>
    </header>

    <main class="wz-body">
      <Transition name="scr" mode="out-in">
        <!-- ① 欢迎 -->
        <section v-if="step === 1" key="s1" class="screen cover">
          <h1 class="slogan reveal d0">科技不再是高高在上，<em>而是服务于人民</em></h1>
          <div class="cover-row">
            <div class="cover-left">
              <p class="lede reveal d1">把实施里重复的流程，一件件交给工具。</p>
              <div class="actions reveal d2">
                <button class="btn-primary" type="button" @click="go(2)">开始设置</button>
                <span class="note">2 步 · 约 1 分钟</span>
              </div>
            </div>
            <div class="flowcard reveal d3">
              <div class="cap">
                <span>实施十步</span>
                <b>规划中 {{ planCount }} / 10</b>
              </div>
              <div class="dots">
                <i v-for="s in IMPL_STEPS" :key="s.n" class="d" :class="{ plan: s.plan }"></i>
              </div>
              <div class="dotnames">
                <span v-for="s in IMPL_STEPS" :key="s.n">{{ s.name.slice(0, 2) }}</span>
              </div>
              <p class="cardnote">只敢说“在规划”：编码、模拟、期初还在打磨，检查刚起头，离做完很远。</p>
            </div>
          </div>
        </section>

        <!-- ② 十大实施步骤 -->
        <section v-else-if="step === 2" key="s2" class="screen steps">
          <h1 class="wz-h1 reveal d0">易助十大实施步骤 <em>· 我们才刚碰到几步</em></h1>
          <div class="creed reveal d1"><i></i><span>科技不再是高高在上，而是服务于人民</span><i></i></div>

          <div class="track reveal d2">
            <div
              v-for="s in IMPL_STEPS"
              :key="s.n"
              class="step"
              :class="{ plan: s.plan, manual: !s.plan && s.tag }"
            >
              <div class="node">{{ s.n }}</div>
              <div class="nm">{{ s.name }}</div>
              <div v-if="s.tag" class="st">{{ s.tag }}</div>
            </div>
          </div>

          <div class="legend reveal d3">
            <span><i class="c1"></i>规划中（工具正在承担这一段）</span>
            <span><i class="c4"></i>人工为主</span>
          </div>

          <div class="notes reveal d4">
            <div v-for="n in NOTES" :key="n.title" class="notecard">
              <b>{{ n.title }}</b>
              <p>{{ n.body }}</p>
            </div>
          </div>

          <div class="strip reveal d5">
            <div class="left">实施流程：规划中 <b>{{ planCount }} / 10</b>（编码·模拟·期初·检查）· 人工为主 {{ 10 - planCount }}</div>
            <div class="btns">
              <button class="btn" type="button" @click="go(1)">上一步</button>
              <button class="btn-primary" type="button" @click="go(3)">连上数据库 →</button>
            </div>
          </div>
        </section>

        <!-- ③ 连接数据库 -->
        <section v-else key="s3" class="screen connect">
          <div class="connect-row">
            <div class="cover-left">
              <h1 class="wz-h1 reveal d0">填写连接信息</h1>
              <p class="lede reveal d1">服务器填 ERP 数据库所在的机器，本机就填 127.0.0.1；账号一般是 sa。</p>
              <div class="tip reveal d2"><i></i>连上后从列表里选一个账套</div>
            </div>

            <div class="panel reveal d3">
              <div class="row3">
                <label class="field">
                  <span>服务器</span>
                  <input v-model="server" type="text" :disabled="busy !== ''" autocomplete="off" />
                  <em>数据库所在机器</em>
                </label>
                <label class="field">
                  <span>账号</span>
                  <input v-model="user" type="text" :disabled="busy !== ''" autocomplete="off" />
                  <em>SQL Server 登录名</em>
                </label>
                <label class="field">
                  <span>密码</span>
                  <input v-model="password" type="password" :disabled="busy !== ''" autocomplete="off" />
                  <em>只存本机</em>
                </label>
              </div>

              <label class="field">
                <span>账套</span>
                <div class="db-row">
                  <select v-model="database" :disabled="busy !== '' || !databases.length">
                    <option value="">{{ databases.length ? '—— 请选择账套 ——' : '—— 请先读取账套 ——' }}</option>
                    <option v-for="d in databases" :key="d" :value="d">{{ d }}</option>
                  </select>
                  <button class="btn" type="button" :disabled="busy !== ''" @click="loadDatabases">
                    {{ busy === 'db' ? '读取中…' : '读取账套' }}
                  </button>
                </div>
              </label>

              <p v-if="message" class="msg" :class="messageKind" role="status" aria-live="polite">{{ message }}</p>

              <div class="panel-foot">
                <button class="btn" type="button" :disabled="busy !== ''" @click="go(2)">上一步</button>
                <button class="btn-primary" type="button" :disabled="busy !== '' || !canSave" @click="save">
                  {{ busy === 'save' ? '保存中…' : '保存并进入软件' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </Transition>
    </main>

    <footer class="wz-foot">
      <span class="ver">v{{ APP_VERSION }}</span>
    </footer>
  </div>
</template>

<style scoped>
.wizard {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  padding: 38px 54px 22px;
  background: var(--paper);
  color: var(--ink);
  overflow: hidden;
}
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.75;
  background-image: radial-gradient(rgba(28, 27, 25, 0.05) 0.5px, transparent 0.5px);
  background-size: 4px 4px;
}
.ink {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(10px);
}
.i1 {
  width: 70vw;
  height: 70vw;
  right: -24vw;
  top: -30vw;
  background: radial-gradient(circle, rgba(28, 27, 25, 0.08), transparent 62%);
  animation: breathe 30s ease-in-out infinite alternate;
}
.i2 {
  width: 52vw;
  height: 52vw;
  left: -20vw;
  bottom: -26vw;
  background: radial-gradient(circle, rgba(168, 50, 45, 0.07), transparent 64%);
  animation: breathe 40s ease-in-out infinite alternate-reverse;
}
@keyframes breathe {
  from { transform: scale(1) translate3d(0, 0, 0); }
  to { transform: scale(1.08) translate3d(-2%, 2%, 0); }
}

/* 顶栏 */
.wz-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
}
.brand { display: flex; align-items: center; gap: 11px; }
.mark { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; box-shadow: 0 3px 10px rgba(28, 27, 25, 0.16); }
.bname { font-size: var(--fs-brand); font-weight: 700; letter-spacing: 0.4px; }
.bsub { font-size: var(--fs-kicker); color: var(--ink-3); margin-top: 1px; }
.kicker { display: flex; align-items: center; gap: 9px; font-size: var(--fs-sub); letter-spacing: 2px; color: var(--ink-3); }
.kicker i { width: 24px; height: 1px; background: var(--seal); opacity: 0.8; display: block; }
.progress { display: flex; align-items: center; gap: 10px; font-size: var(--fs-sub); letter-spacing: 3px; color: var(--ink-3); }
.progress b { font-weight: 600; }
.progress b.on { color: var(--seal); }
.progress i { width: 30px; height: 1px; background: var(--line); display: block; }

/* 主体 */
.wz-body { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
.screen { width: 100%; display: flex; flex-direction: column; justify-content: center; }

.wz-h1 { margin: 0; font-size: 38px; line-height: 1.16; letter-spacing: -1px; font-weight: 900; white-space: nowrap; }
.wz-h1 em { font-style: normal; color: var(--seal); }

/* ① 欢迎 */
.slogan { margin: 0; font-size: 52px; line-height: 1.1; letter-spacing: -1.2px; font-weight: 900; white-space: nowrap; }
.slogan em { font-style: normal; color: var(--seal); }
.cover-row { display: grid; grid-template-columns: minmax(0, 1fr) 430px; align-items: center; gap: 56px; margin-top: 30px; }
.lede { margin: 0; font-size: var(--fs-body); line-height: 1.9; color: var(--ink-2); }
.actions { margin-top: 26px; display: flex; align-items: center; gap: 16px; }
.note { font-size: var(--fs-sub); color: var(--ink-3); }

.btn-primary {
  border: 1px solid var(--seal);
  background: var(--seal);
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  padding: 12px 26px;
  border-radius: 7px;
  font-size: var(--fs-body);
  font-weight: 600;
  letter-spacing: 0.6px;
  box-shadow: 0 8px 22px rgba(168, 50, 45, 0.2);
  transition: transform 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(168, 50, 45, 0.26); }
.btn {
  border: 1px solid var(--line);
  background: var(--paper-2);
  color: var(--ink-2);
  cursor: pointer;
  font-family: inherit;
  padding: 11px 18px;
  border-radius: 7px;
  font-size: var(--fs-sub);
  font-weight: 600;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.btn:hover:not(:disabled) { border-color: var(--seal); color: var(--seal); }
.btn:disabled, .btn-primary:disabled { opacity: 0.5; cursor: default; }

.flowcard { background: var(--paper-2); border: 1px solid var(--line); border-radius: 12px; padding: 20px 22px 18px; box-shadow: 0 16px 40px rgba(28, 27, 25, 0.07); }
.flowcard .cap { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.flowcard .cap span { font-size: var(--fs-kicker); letter-spacing: 2px; color: var(--ink-3); }
.flowcard .cap b { font-size: var(--fs-sub); color: var(--seal); }
.dots { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin: 14px 0 8px; }
.d { height: 6px; border-radius: 3px; background: var(--line-soft); }
.d.plan { background: transparent; box-shadow: inset 0 0 0 1px var(--seal); opacity: 0.85; }
.dotnames { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; font-size: 10px; color: var(--ink-3); text-align: center; }
.cardnote { margin: 14px 0 0; font-size: var(--fs-kicker); line-height: 1.7; color: var(--ink-3); }

/* ② 十步 */
.creed { display: flex; align-items: center; justify-content: center; gap: 18px; margin: 24px 0 0; }
.creed i { display: block; width: 64px; height: 1px; background: var(--line); }
.creed span { font-size: 19px; letter-spacing: 2px; color: var(--ink-2); white-space: nowrap; }

.track { position: relative; margin: 32px 0 0; display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 6px; }
.track::before { content: ''; position: absolute; left: 0; right: 0; top: 19px; height: 1px; background: var(--line); }
.step { position: relative; text-align: center; }
.node {
  position: relative;
  z-index: 1;
  width: 38px;
  height: 38px;
  margin: 0 auto;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: var(--fs-sub);
  font-weight: 700;
  background: var(--paper-2);
  border: 1px dashed var(--line);
  color: var(--ink-3);
}
.nm { margin-top: 10px; font-size: var(--fs-sub); font-weight: 600; color: var(--ink-2); letter-spacing: 0.4px; }
.st { margin-top: 7px; font-size: var(--fs-kicker); color: var(--ink-3); }
.st::before { content: '·'; margin-right: 4px; }
.step.plan .node { border: 1px dashed var(--seal); color: var(--seal); background: var(--seal-wash); }
.step.plan .nm { color: var(--ink); }
.step.plan .st { color: var(--seal); }

.legend { display: flex; align-items: center; gap: 22px; margin-top: 30px; font-size: var(--fs-kicker); color: var(--ink-3); }
.legend span { display: inline-flex; align-items: center; gap: 7px; }
.legend i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.legend .c1 { background: var(--seal); }
.legend .c4 { border: 1px dashed var(--ink-3); }

.notes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
.notecard { background: var(--paper-2); border: 1px solid var(--line); border-radius: 10px; padding: 15px 16px; }
.notecard b { display: block; font-size: var(--fs-sub); margin-bottom: 6px; }
.notecard p { margin: 0; font-size: var(--fs-kicker); line-height: 1.7; color: var(--ink-3); }

.strip { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--line-soft); }
.strip .left { font-size: var(--fs-sub); color: var(--ink-3); }
.strip .left b { color: var(--seal); font-weight: 600; }
.btns { display: flex; gap: 12px; }

/* ③ 连接 */
.connect-row { display: grid; grid-template-columns: minmax(0, 1fr) 520px; align-items: center; gap: 56px; }
.connect .lede { margin-top: 14px; }\n.tip { margin-top: 20px; display: inline-flex; align-items: center; gap: 9px; font-size: var(--fs-sub); color: var(--ink-3); }
.tip i { width: 24px; height: 1px; background: var(--seal); opacity: 0.75; display: block; }
.panel { background: var(--paper-2); border: 1px solid var(--line); border-radius: 12px; padding: 24px 24px 20px; box-shadow: 0 20px 50px rgba(28, 27, 25, 0.08); }
.row3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.field { display: block; margin-bottom: 15px; font-style: normal; }
.field > span { display: block; font-size: var(--fs-kicker); letter-spacing: 1.2px; color: var(--ink-3); margin-bottom: 7px; }
.field input, .field select {
  width: 100%;
  padding: 10px 12px;
  font-size: var(--fs-body);
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.field input:focus, .field select:focus { border-color: var(--seal); background: #fff; box-shadow: 0 0 0 3px var(--seal-wash); }
.field em { display: block; margin-top: 6px; font-size: var(--fs-kicker); font-style: normal; color: var(--ink-3); }
.db-row { display: flex; gap: 10px; }
.db-row select { flex: 1; }
.msg { margin: 4px 0 0; font-size: var(--fs-sub); }
.msg.ok { color: var(--ok); }
.msg.err { color: var(--seal); }
.panel-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 4px; padding-top: 16px; border-top: 1px solid var(--line-soft); }

/* 页脚 */
.wz-foot { position: relative; flex: 0 0 auto; display: flex; justify-content: flex-end; border-top: 1px solid var(--line); padding-top: 12px; font-size: var(--fs-kicker); color: var(--ink-3); }
.ver { font-family: Consolas, monospace; }

/* 切屏与入场 */
.scr-enter-active, .scr-leave-active { transition: opacity 0.32s ease, transform 0.32s ease; }
.scr-enter-from { opacity: 0; transform: translateY(10px); }
.scr-leave-to { opacity: 0; transform: translateY(-8px); }

.reveal { animation: rise 0.52s cubic-bezier(0.22, 0.61, 0.36, 1) both; }
.d0 { animation-delay: 0.02s; }
.d1 { animation-delay: 0.09s; }
.d2 { animation-delay: 0.16s; }
.d3 { animation-delay: 0.23s; }
.d4 { animation-delay: 0.3s; }
.d5 { animation-delay: 0.37s; }
@keyframes rise {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .reveal, .ink, .i1, .i2 { animation: none !important; }
  .scr-enter-active, .scr-leave-active { transition: none; }
}
</style>
