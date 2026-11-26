<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'

const route = useRoute()
const store = useAppStore()

const title = computed(() => String(route.meta.title ?? 'N-B助手'))
const connHint = computed(() => store.connError || store.connLabel)
</script>

<template>
  <header class="topbar">
    <div class="left">
      <h1>{{ title }}</h1>
    </div>

    <div class="right">
      <div class="conn" :class="store.conn" :title="connHint">
        <i class="dot" />
        <span>{{ store.connLabel }}</span>
      </div>

      <div v-if="store.database" class="db" :title="store.server">
        <span class="db-label">账套</span>
        <strong>{{ store.database }}</strong>
      </div>

      <button class="refresh" type="button" :disabled="store.conn === 'checking'" @click="store.reconnect()">
        重新连接
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
  /* 右侧留出系统最小化/最大化/关闭按钮的位置（自绘标题栏） */
  padding: 0 150px 0 22px;
  /* 与 titleBarOverlay 的底色完全一致，避免右上角出现色块 */
  background: var(--paper);
  -webkit-app-region: drag;
}

.left h1 {
  font-size: var(--fs-topbar);
  letter-spacing: 1px;
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
  font-size: var(--fs-sub);
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

.conn.ready {
  color: var(--ink-2);
}

/* 只读了配置、还没真连数据库：用琥珀色，避免「已配置」被误读成「已连通」 */
.conn.configured .dot {
  background: var(--warn);
}

.conn.configured {
  color: var(--ink-2);
}

.conn.error .dot {
  background: var(--err);
  box-shadow: 0 0 0 3px var(--seal-wash);
}

.conn.error {
  color: var(--ink-2);
}

.conn.checking .dot {
  background: var(--warn);
}

.db {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--fs-sub);
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
  font-size: var(--fs-sub);
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
