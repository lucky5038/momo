<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
// 必须用 computed：同一组件被多个路由复用，route.meta 变化不会重跑 setup
const title = computed(() => String(route.meta.title ?? ''))
const desc = computed(() => String(route.meta.desc ?? ''))
const icon = computed(() => String(route.meta.icon ?? ''))
const stage = computed(() => String(route.meta.stage ?? ''))
</script>

<template>
  <section class="placeholder">
    <div class="paper-card head">
      <span class="icon">{{ icon }}</span>
      <div class="text">
        <h2>{{ title }}</h2>
        <p class="desc">{{ desc }}</p>
      </div>
      <span class="stage">{{ stage }}</span>
    </div>

    <div class="paper-card body">
      <p class="hint">P0 阶段只交付外壳与主题，本模块的界面正在迁移到 Vue 3，功能尚未接入。</p>
      <p class="hint">旧版界面（<code>index.html</code>）仍在正常工作，切换完成后本页才会替换它。</p>
    </div>
  </section>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 22px;
}

.icon {
  font-size: 26px;
  line-height: 1.2;
}

.text {
  flex: 1;
}

.text h2 {
  font-size: 20px;
  letter-spacing: 0.5px;
}

.desc {
  margin: 6px 0 0;
  color: var(--ink-2);
}

.stage {
  flex: none;
  font-size: 12px;
  color: var(--seal);
  background: var(--seal-wash);
  border: 1px solid rgba(168, 50, 45, 0.18);
  border-radius: 999px;
  padding: 2px 10px;
  white-space: nowrap;
}

.body {
  padding: 18px 22px;
}

.hint {
  margin: 0 0 8px;
  color: var(--ink-3);
  font-size: 13px;
}

.hint:last-child {
  margin-bottom: 0;
}

code {
  font-family: Consolas, "Courier New", monospace;
  background: var(--wash);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--ink-2);
}
</style>
