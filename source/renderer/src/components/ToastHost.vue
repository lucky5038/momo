<script setup lang="ts">
import { dismissToast, useToasts } from '../lib/toast'

const items = useToasts()
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <button
      v-for="t in items"
      :key="t.id"
      class="toast"
      :class="t.kind"
      type="button"
      title="点击关闭"
      @click="dismissToast(t.id)"
    >
      {{ t.text }}
    </button>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  max-width: 420px;
  font-family: inherit;
  font-size: var(--fs-sub);
  line-height: 1.5;
  text-align: left;
  padding: 8px 14px;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-left: 3px solid var(--ink-3);
  border-radius: var(--radius);
  box-shadow: var(--shadow-pop);
  cursor: pointer;
}

.toast.ok {
  border-left-color: var(--ok);
}

.toast.warn {
  border-left-color: var(--warn);
}

.toast.err {
  border-left-color: var(--seal);
}
</style>
