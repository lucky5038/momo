<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { MODULES } from '../config/app'

const route = useRoute()
// 必须用 computed：同一组件被多个路由复用，route.meta 变化不会重跑 setup
const title = computed(() => String(route.meta.title ?? ''))
const desc = computed(() => String(route.meta.desc ?? ''))
const icon = computed(() => String(route.meta.icon ?? ''))
const stage = computed(() => String(route.meta.stage ?? ''))
const planned = computed(() => MODULES.find((m) => m.key === route.meta.key)?.planned ?? null)
</script>

<template>
  <section class="placeholder">
    <div class="paper-card head">
      <span class="icon">{{ icon }}</span>
      <div class="text">
        <div v-if="planned" class="kicker">{{ planned.kicker }}</div>
        <h2>{{ title }}</h2>
        <p class="desc">{{ desc }}</p>
      </div>
      <span v-if="planned" class="badge">{{ planned.badge }}</span>
      <span v-else class="stage">{{ stage }}</span>
    </div>

    <template v-if="planned">
      <div class="sample">
        <span class="sample-label">{{ planned.sampleLabel }}</span>
        <code>{{ planned.sampleCode }}</code>
        <template v-if="planned.sampleArrow">
          <span class="arrow">{{ planned.sampleArrow }}</span>
          <span class="sub">{{ planned.sampleText }}</span>
        </template>
      </div>

      <div class="points">
        <div v-for="p in planned.points" :key="p.b" class="point">
          <b>{{ p.b }}</b>
          <span>{{ p.t }}</span>
        </div>
      </div>

      <p class="note">{{ planned.note }}</p>
    </template>

    <div v-else class="paper-card body">
      <p class="hint">本模块的界面正在迁移到 Vue 3，功能尚未接入。</p>
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

.kicker {
  font-size: var(--fs-kicker);
  font-weight: 600;
  letter-spacing: 1.2px;
  color: var(--ink-3);
  margin-bottom: 4px;
}

.text h2 {
  font-size: var(--fs-page-title);
  letter-spacing: normal;
}

.desc {
  margin: 6px 0 0;
  font-size: var(--fs-sub);
  color: var(--ink-3);
}

.stage,
.badge {
  flex: none;
  font-size: var(--fs-kicker);
  border-radius: 999px;
  padding: 2px 10px;
  white-space: nowrap;
}

.stage {
  color: var(--seal);
  background: var(--seal-wash);
  border: 1px solid rgba(168, 50, 45, 0.18);
}

.badge {
  color: var(--ink-2);
  background: var(--wash);
  border: 1px solid var(--line);
}

.sample {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.sample-label {
  font-size: 12px;
  color: var(--ink-3);
}

.arrow {
  color: var(--seal);
}

.sub {
  color: var(--ink-3);
  font-size: var(--fs-sub);
}

.points {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.point {
  padding: 12px 16px;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.point b {
  display: block;
  font-size: var(--fs-body);
  font-weight: 600;
  margin-bottom: 4px;
}

.point span {
  color: var(--ink-3);
  font-size: var(--fs-sub);
}

.note {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-sub);
}

.body {
  padding: 18px 22px;
}

.hint {
  margin: 0 0 8px;
  color: var(--ink-3);
  font-size: var(--fs-sub);
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
