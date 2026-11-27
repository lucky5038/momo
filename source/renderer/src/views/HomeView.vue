<script setup lang="ts">
/** 主界面：实施十步铺满整屏。可点的三步进对应模块，其余给"规划中"提示 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import StepIcon from '../components/StepIcon.vue'
import { toast } from '../lib/toast'
import { useAppStore } from '../stores/app'
import { APP_VERSION, STEPS } from '../config/app'

const app = useAppStore()
const router = useRouter()

const steps = computed(() => STEPS)

function open(no: string) {
  const step = steps.value.find((s) => s.no === no)
  if (!step) return
  if (step.path) {
    void router.push(step.path)
    return
  }
  toast(`${step.no} ${step.title}：这一步还在规划中`, 'warn')
}

onMounted(() => {
  // 主界面也刷新一次连接文案（失败不打扰）
  if (app.conn === 'unknown') void app.checkConnection()
})
</script>

<template>
  <div class="home">
    <div class="topbar">
      <div class="brand">
        <img src="../assets/app-icon.png" alt="N-B助手" />
        <div class="txt"><b>N-B助手</b><span>实施流程优化</span></div>
      </div>

      <h1 class="slogan">科技不再是高高在上，而是服务于人民</h1>

      <div class="stat">
        <div class="group">
          <div class="conn" :class="app.conn" :title="app.connError || app.connLabel">
            <i class="dot" />
            <span>{{ app.connLabel }}</span>
          </div>
          <div v-if="app.database" class="db"><span>账套</span><strong>{{ app.database }}</strong></div>
          <button class="gear" type="button" title="系统设置" @click="router.push('/settings')">⚙</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <button
        v-for="s in steps"
        :key="s.no"
        type="button"
        class="step"
        :class="s.status === 'dev' ? 'dev' : 'plan'"
        @click="open(s.no)"
      >
        <span class="no">{{ s.no }}</span>
        <span class="art"><StepIcon :name="s.icon" /></span>
        <span class="nm">{{ s.title }}</span>
        <span class="st"><i />{{ s.status === 'dev' ? '正在开发' : '规划中' }}</span>
        <span v-if="s.path" class="go">进入 →</span>
      </button>
    </div>

    <div class="foot">
      <span class="nb">预留 · N-B · 规划中</span>
      <span>v{{ APP_VERSION }}</span>
    </div>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px 28px 6px;
}

/* 背景墨影由 App.vue 统一提供，这里只负责排版 */

.topbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 50px;
  /* 右侧让开自绘标题栏的窗口按钮区（titleBarOverlay 150px） */
  padding-right: 150px;
  -webkit-app-region: drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand img {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  object-fit: cover;
}

.brand .txt b {
  font-size: var(--fs-brand);
  letter-spacing: 0.5px;
}

.brand .txt span {
  display: block;
  margin-top: 1px;
  font-size: var(--fs-kicker);
  color: var(--ink-3);
}

/* 口号：绝对居中，不参与两侧布局，保证任何窗口宽度都真居中 */
.slogan {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 1.6px;
  white-space: nowrap;
  color: var(--ink);
  pointer-events: none;
}

.stat {
  -webkit-app-region: no-drag;
}

.group {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 6px 0 12px;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: rgba(255, 253, 247, 0.72);
  font-size: var(--fs-xs);
  color: var(--ink-3);
  -webkit-app-region: no-drag;
}

.conn {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
}

.conn.ready .dot {
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-wash);
}

.conn.configured .dot,
.conn.checking .dot {
  background: var(--warn);
}

.conn.error .dot {
  background: var(--err);
  box-shadow: 0 0 0 3px var(--seal-wash);
}

.db {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--line-soft);
  white-space: nowrap;
}

.db strong {
  font-weight: 600;
  color: var(--ink);
}

.gear {
  -webkit-app-region: no-drag;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.gear:hover {
  border-color: var(--seal);
  color: var(--seal);
}
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.step {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  text-align: center;
  padding: 13px 15px;
  border-radius: var(--radius);
  border: 1px dashed var(--line);
  background: var(--paper-3);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease;
}

.step .no {
  font-size: 10.5px;
  letter-spacing: 1.8px;
  color: var(--ink-3);
}

.step .art {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  opacity: 0.5;
}

.step .nm {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 1.5px;
  line-height: 1.2;
  color: var(--ink);
}

.step .st {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  font-size: var(--fs-kicker);
  color: var(--ink-3);
}

.step .st i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
}

.step .go {
  position: absolute;
  right: 15px;
  bottom: 14px;
  font-size: var(--fs-xs);
  color: var(--seal);
}

.step.dev {
  background: var(--paper-2);
  border: 1px solid var(--seal-line);
  box-shadow: var(--shadow-pop);
}

.step.dev .no,
.step.dev .st,
.step.dev .go {
  color: var(--seal);
}

.step.dev .art {
  color: var(--seal);
  opacity: 0.92;
}

.step.dev .st i {
  opacity: 1;
}

.step.dev::after {
  content: '';
  position: absolute;
  left: -50px;
  top: -60px;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  background: var(--seal-wash);
  pointer-events: none;
}

.step:hover {
  border-color: var(--seal);
  transform: translateY(-1px);
}

.step.plan:hover {
  border-color: var(--warn);
}

.nb {
  font-size: 10.5px;
  letter-spacing: 1.2px;
  color: var(--ink-3);
  opacity: 0.8;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
  font-size: var(--fs-kicker);
  color: var(--ink-3);
}
</style>
