<script setup lang="ts">
/** 模块页顶栏：小品牌 + 返回十步 + 当前位置 + 连接状态 + 设置齿轮（自绘标题栏，右侧留出系统按钮区） */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'

const route = useRoute()
const store = useAppStore()

const title = computed(() => String(route.meta.title ?? '带值'))
const step = computed(() => String(route.meta.step ?? ''))
const connHint = computed(() => store.connError || store.connLabel)
</script>

<template>
  <header class="topbar">
    <div class="left">
      <button class="back" type="button" title="返回十步" @click="$router.push('/')">← 十步</button>
      <span class="crumb">
        <span v-if="step">易助实施 · <b>{{ step }}</b></span>
        <span v-else>{{ title }}</span>
      </span>
      <h1>{{ title }}</h1>
    </div>

    <div class="right">
      <div class="conn" :class="store.conn" :title="connHint">
        <i class="dot" />
        <span>{{ store.connLabel }}</span>
      </div>
      <div v-if="store.database" class="db" :title="store.server">
        <span>账套</span><strong>{{ store.database }}</strong>
      </div>
      <button class="refresh" type="button" :disabled="store.conn === 'checking'" @click="store.reconnect()">
        重新连接
      </button>
      <button class="gear" type="button" title="系统设置" @click="$router.push('/settings')">⚙</button>
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
  font-family: inherit;
  font-size: var(--fs-xs);
  color: var(--ink-2);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 11px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.back:hover {
  border-color: var(--seal);
  color: var(--seal);
}

.crumb {
  font-size: var(--fs-kicker);
  color: var(--ink-3);
  white-space: nowrap;
}

.crumb b {
  color: var(--seal);
  font-weight: 600;
}

.left h1 {
  margin: 0;
  padding-left: 12px;
  border-left: 1px solid var(--line-soft);
  font-size: var(--fs-topbar);
  letter-spacing: 1px;
  white-space: nowrap;
}

.right {
  display: flex;
  align-items: center;
  gap: 14px;
  -webkit-app-region: no-drag;
}

.conn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-kicker);
  color: var(--ink-3);
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
  padding-left: 13px;
  border-left: 1px solid var(--line-soft);
  font-size: var(--fs-kicker);
  color: var(--ink-3);
}

.db strong {
  font-weight: 600;
  color: var(--ink);
}

.refresh,
.gear {
  font-family: inherit;
  font-size: var(--fs-kicker);
  color: var(--ink-2);
  background: var(--paper-2);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.refresh {
  border-radius: var(--radius);
  padding: 4px 11px;
}

.gear {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 13px;
  line-height: 1;
}

.refresh:hover:not(:disabled),
.gear:hover {
  border-color: var(--seal);
  color: var(--seal);
}

.refresh:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
