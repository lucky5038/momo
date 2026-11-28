<script setup lang="ts">
/** 尚未开发的模块：只留一句说明，不铺卡片与多余文案 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => String(route.meta.title ?? ''))
const desc = computed(() => String(route.meta.desc ?? ''))
</script>

<template>
  <section class="placeholder">
    <p class="hint"><b>{{ title }}</b><template v-if="desc"> · {{ desc }}</template></p>
    <p class="hint dim">这一步还在规划中，功能尚未开发。</p>
  </section>
</template>

<style scoped>
.placeholder {
  padding: 18px 4px;
}

.hint {
  margin: 0 0 6px;
  font-size: var(--fs-sub);
  color: var(--ink-2);
}

.hint.dim {
  color: var(--ink-3);
  margin-bottom: 0;
}

.hint b {
  font-weight: 600;
}
</style>
