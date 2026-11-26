<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'

const route = useRoute()
const store = useAppStore()

const title = computed(() => String(route.meta.title ?? 'N-B助手'))
const connLabel = computed(() => {
  switch (store.conn) {
    case 'ok':
      return '已就绪'
    case 'error':
      return '异常'
    case 'checking':
      return '检测中'
    default:
      return '未检测'
  }
})
</script>

<template>
  <header class="topbar">
    <div class="left">
      <h1>{{ title }}</h1>
    </div>

    <div class="right">
      <div class="conn" :class="store.conn" :title="store.connText">
        <i class="dot" />
        <span>{{ connLabel }}</span>
      </div>

      <div v-if="store.database" class="db" :title="store.server">
        <span class="db-label">账套</span>
        <strong>{{ store.database }}</strong>
      </div>

      <button class="refresh" type="button" :disabled="store.conn === 'checking'" @click="store.checkConnection()">
        刷新状态
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 52px;
  padding: 0 22px;
  background: rgba(255, 253, 247, 0.86);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(4px);
}

.left h1 {
  font-size: 17px;
  letter-spacing: 1px;
}

.right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.conn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-3);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
}

.conn.ok .dot {
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(63, 122, 94, 0.14);
}

.conn.ok {
  color: var(--ok);
}

.conn.error .dot {
  background: var(--err);
  box-shadow: 0 0 0 3px rgba(168, 50, 45, 0.12);
}

.conn.error {
  color: var(--seal);
}

.conn.checking .dot {
  background: var(--warn);
}

.db {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12.5px;
  padding-left: 14px;
  border-left: 1px solid var(--line-soft);
}

.db-label {
  color: var(--ink-3);
}

.db strong {
  font-weight: 600;
  color: var(--ink);
}

.refresh {
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 5px 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.refresh:hover:not(:disabled) {
  border-color: var(--seal);
  color: var(--seal);
}

.refresh:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
