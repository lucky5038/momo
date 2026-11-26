<script setup lang="ts">
/** 可搜索的列下拉（旧界面 openCb/closeCb/pickCb 的组件化版本）。
 *  命中规则与旧版一致：列名或说明包含输入内容（不区分大小写）。
 *  键盘：↑↓ 移动高亮、Enter 选中、Esc 关闭；失焦延迟关闭，计时器在卸载时清理。 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { ColInfo } from '../api/crossfill'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: ColInfo[]
    placeholder?: string
    emptyText?: string
    disabled?: boolean
    /** 无障碍：关联的外部 <label> id */
    labelId?: string
  }>(),
  { placeholder: '', emptyText: '没有可选项', disabled: false, labelId: '' },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const text = ref(props.modelValue)
const active = ref(0)
const listId = `cbl-${Math.random().toString(36).slice(2, 8)}`
let blurTimer = 0

watch(
  () => props.modelValue,
  (v) => {
    text.value = v
    active.value = 0
  },
)

const matched = computed(() => {
  const k = text.value.trim().toUpperCase()
  const list = props.options
  const hit = k
    ? list.filter((o) => o.col.toUpperCase().includes(k) || (o.desc ?? '').toUpperCase().includes(k))
    : list
  return hit.slice(0, 100)
})

watch(matched, () => {
  active.value = 0
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
  window.clearTimeout(blurTimer)
  blurTimer = window.setTimeout(() => {
    open.value = false
  }, 150)
}

function close() {
  window.clearTimeout(blurTimer)
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (e.key === 'ArrowDown') {
    if (!open.value) {
      open.value = true
      return
    }
    e.preventDefault()
    if (matched.value.length) active.value = (active.value + 1) % matched.value.length
  } else if (e.key === 'ArrowUp') {
    if (!open.value) return
    e.preventDefault()
    if (matched.value.length) {
      active.value = (active.value - 1 + matched.value.length) % matched.value.length
    }
  } else if (e.key === 'Enter') {
    if (!open.value) return
    e.preventDefault()
    const hit = matched.value[active.value]
    if (hit) pick(hit)
  } else if (e.key === 'Escape') {
    if (open.value) {
      e.preventDefault()
      close()
    }
  }
}

onUnmounted(() => window.clearTimeout(blurTimer))
</script>

<template>
  <div class="combo">
    <input
      :value="text"
      :placeholder="placeholder"
      :disabled="disabled"
      type="text"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-labelledby="labelId || undefined"
      :aria-activedescendant="open && matched.length ? `${listId}-${active}` : undefined"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
      @mousedown="open = !disabled"
    />
    <ul v-if="open" :id="listId" class="cb" role="listbox">
      <li v-if="!matched.length" class="empty">{{ emptyText }}</li>
      <li
        v-for="(o, i) in matched"
        :id="`${listId}-${i}`"
        :key="o.col"
        role="option"
        :aria-selected="i === active"
        :class="{ on: i === active }"
        @mousedown.prevent="pick(o)"
        @mouseenter="active = i"
      >
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
  font-size: var(--fs-body);
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
  box-shadow: var(--shadow-pop);
}

.cb li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--fs-sub);
}

.cb li:hover,
.cb li.on {
  background: var(--seal-wash);
}

.cb .col {
  color: var(--ink);
  font-weight: 600;
}

.cb .desc {
  color: var(--ink-3);
  font-size: var(--fs-kicker);
}

.cb .empty {
  color: var(--ink-3);
  cursor: default;
}

.cb .empty:hover {
  background: none;
}
</style>
