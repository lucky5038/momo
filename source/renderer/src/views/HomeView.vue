<script setup lang="ts">
/** 主界面：实施十步铺满整屏。可点的三步进对应模块，其余给"规划中"提示 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import StepIcon from '../components/StepIcon.vue'
import StatusPill from '../components/StatusPill.vue'
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
        <StatusPill />
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
}

/* 背景墨影由 App.vue 统一提供，这里只负责排版 */

.topbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  /* 与模块页顶栏同一几何：右 150 让开窗口按钮，左 20 */
  padding: 0 150px 0 20px;
  background: var(--paper);
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
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 1.4px;
  white-space: nowrap;
  color: var(--ink);
  pointer-events: none;
}

.stat {
  -webkit-app-region: no-drag;
}













.grid {
  flex: 1;
  min-height: 0;
  padding: 8px 26px 0;
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





.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
  font-size: var(--fs-kicker);
  color: var(--ink-3);
}
</style>
