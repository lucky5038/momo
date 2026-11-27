<script setup lang="ts">
/** 模块页顶栏：返回 + 当前位置；右上统一状态胶囊（StatusPill）
 *  自绘标题栏，右侧留出系统按钮区 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StatusPill from './StatusPill.vue'

const route = useRoute()
const router = useRouter()

const title = computed(() => String(route.meta.title ?? '带值'))
const step = computed(() => String(route.meta.step ?? ''))
/** 系统设置是全局入口（右上角齿轮进），不属于十步流程 */
const isGlobal = computed(() => !step.value)

function goBack() {
  if (isGlobal.value) {
    window.history.length > 1 ? window.history.back() : void router.push('/')
    return
  }
  void router.push('/')
}
</script>

<template>
  <header class="topbar">
    <div class="left">
      <button class="back" type="button" :title="isGlobal ? '返回上一页' : '返回主界面'" @click="goBack">
        {{ isGlobal ? '← 返回' : '← 返回主界面' }}
      </button>
      <span v-if="step" class="crumb">易助实施 · <b>{{ step }}</b></span>
      <h1>{{ title }}</h1>
    </div>

    <div class="right">
      <StatusPill />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  height: 52px;
  /* 右侧留给系统最小化/最大化/关闭按钮（自绘标题栏） */
  padding: 0 150px 0 20px;
  background: var(--paper);
  -webkit-app-region: drag;
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.back {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper-2);
  color: var(--ink-2);
  font-size: var(--fs-xs);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.back:hover {
  border-color: var(--seal);
  color: var(--seal);
}

.crumb {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  white-space: nowrap;
}

.crumb b {
  color: var(--seal);
  font-weight: 600;
}

.left h1 {
  margin: 0;
  font-size: var(--fs-topbar);
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.right {
  display: flex;
  align-items: center;
  gap: 14px;
  -webkit-app-region: no-drag;
}
</style>
