<script setup lang="ts">
/** 全局统一的右上状态胶囊：连接状态 / 账套 / 预留位 / 重新连接 / 设置
 *  主界面与模块页共用同一套视觉与顺序，避免两处长得不一样 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const route = useRoute()
const router = useRouter()

const hint = computed(() => app.connError || app.connLabel)
/** 已经在系统设置页时就不再显示齿轮 */
const onSettings = computed(() => route.path === '/settings')
</script>

<template>
  <div class="pill" :class="app.conn" :title="hint">
    <div class="conn" :class="app.conn">
      <i class="dot" />
      <span>{{ app.connLabel }}</span>
    </div>

    <div v-if="app.database" class="db" :title="app.server || undefined">
      <span>账套</span><strong>{{ app.database }}</strong>
    </div>

    <span class="nb" title="预留位：N-B（规划中）"><b>预留 · N-B</b></span>

    <button
      class="icon"
      type="button"
      title="重新连接"
      :disabled="app.conn === 'checking'"
      @click="app.reconnect()"
    >⟳</button>

    <button v-if="!onSettings" class="icon" type="button" title="系统设置" @click="router.push('/settings')">⚙</button>
  </div>
</template>

<style scoped>
.pill {
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
  white-space: nowrap;
  -webkit-app-region: no-drag;
}

.conn {
  display: flex;
  align-items: center;
  gap: 6px;
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
}

.db strong {
  font-weight: 600;
  color: var(--ink);
}

.nb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--line-soft);
}

.nb b {
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--ink-2);
}

.icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.icon:hover {
  background: var(--wash);
  color: var(--seal);
}

.icon:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
