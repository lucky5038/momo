<script setup lang="ts">
/** 可搜索的列下拉（旧界面 openCb/closeCb/pickCb 的组件化版本）。
 *  命中规则与旧版一致：列名或说明包含输入内容（不区分大小写）。 */
import { computed, ref, watch } from 'vue'
import type { ColInfo } from '../api/crossfill'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: ColInfo[]
    placeholder?: string
    emptyText?: string
    disabled?: boolean
  }>(),
  { placeholder: '', emptyText: '没有可选项', disabled: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const text = ref(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    text.value = v
  },
)

const matched = computed(() => {
  const k = text.value.trim().toUpperCase()
  const list = props.options ?? []
  const hit = k
    ? list.filter((o) => o.col.toUpperCase().includes(k) || (o.desc ?? '').toUpperCase().includes(k))
    : list
  return hit.slice(0, 100)
})

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value
  emit('update:modelValue', text.value)
  open.value = true
}

function pick(o: ColInfo) {
  text.value = o.col
  emit('update:modelValue', o.col)
  open.value = false
}

function onFocus() {
  if (!props.disabled) open.value = true
}

function onBlur() {
  window.setTimeout(() => {
    open.value = false
  }, 150)
}
</script>

<template>
  <div class="combo">
    <input
      :value="text"
      :placeholder="placeholder"
      :disabled="disabled"
      type="text"
      autocomplete="off"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @mousedown="open = !disabled"
    />
    <ul v-if="open" class="cb">
      <li v-if="!matched.length" class="empty">{{ emptyText }}</li>
      <li v-for="o in matched" :key="o.col" @mousedown.prevent="pick(o)">
        <span class="col">{{ o.col }}</span>
        <span class="desc">{{ o.desc || '' }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
}

.combo input {
  width: 100%;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 7px 10px;
  outline: none;
}

.combo input:focus {
  border-color: var(--seal);
}

.combo input:disabled {
  background: var(--wash);
  color: var(--ink-3);
  cursor: not-allowed;
}

.cb {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  max-height: 260px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(28, 27, 25, 0.12);
}

.cb li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12.5px;
}

.cb li:hover {
  background: var(--seal-wash);
}

.cb .col {
  color: var(--ink);
  font-weight: 600;
}

.cb .desc {
  color: var(--ink-3);
  font-size: 11.5px;
}

.cb .empty {
  color: var(--ink-3);
  cursor: default;
}

.cb .empty:hover {
  background: none;
}
</style>
