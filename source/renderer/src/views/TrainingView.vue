<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { TRAIN_MODULES, type TrainModule, type TrainNode } from '../config/training'

const QC_KEY = 'nb_training_qc'

const mod: TrainModule = TRAIN_MODULES[0]
const qcOn = ref(localStorage.getItem(QC_KEY) === '1')
const selected = ref<string>('recv')

watch(qcOn, (v) => {
  localStorage.setItem(QC_KEY, v ? '1' : '0')
  if (!v && selected.value === 'qc') selected.value = 'recv'
})

const nodeMap = computed(() => {
  const m: Record<string, TrainNode> = {}
  for (const n of mod.nodes) m[n.key] = n
  return m
})

const chains = computed(() =>
  mod.chains
    .filter((c) => !c.qcOnly || qcOn.value)
    .map((c) => ({
      ...c,
      nodeKeys: c.nodes.filter((k) => qcOn.value || !nodeMap.value[k]?.qcOnly),
    }))
    .filter((c) => c.nodeKeys.length > 0),
)

const doc = computed(() => mod.docs[selected.value])
const selectedName = computed(() => nodeMap.value[selected.value]?.name ?? '')

function pick(key: string) {
  if (!qcOn.value && nodeMap.value[key]?.qcOnly) return
  selected.value = key
}
</script>

<template>
  <section class="train">
    <div class="head">
      <span class="kick">05 培训</span>
      <h2>{{ mod.name }}</h2>

      <label v-if="mod.qcToggle" class="switch">
        <input v-model="qcOn" type="checkbox" />
        <span class="track"><i /></span>
        <span class="label">走检验（QC）</span>
      </label>

      <span class="hint">点任一单据 → 右边六问</span>
    </div>

    <div class="body">
      <div class="panel">
        <div v-for="c in chains" :key="c.key" class="chain">
          <div class="cname">{{ c.name }}</div>
          <div class="row">
            <template v-for="(k, i) in c.nodeKeys" :key="k + i">
              <span v-if="i > 0" class="arw">→</span>
              <button class="node" :class="{ on: selected === k, qc: nodeMap[k]?.qcOnly }" @click="pick(k)">
                <b>{{ nodeMap[k]?.name }}</b>
                <em>{{ nodeMap[k]?.role }}</em>
              </button>
            </template>
          </div>
        </div>
      </div>

      <div class="panel side">
        <div class="dname">{{ selectedName }}</div>
        <template v-if="doc">
          <div class="q">
            <h4>做什么 · What</h4>
            <p>{{ doc.what }}</p>
          </div>
          <div class="q">
            <h4>为什么 · Why</h4>
            <p>{{ doc.why }}</p>
          </div>
          <div class="q">
            <h4>谁做 · Who</h4>
            <p v-for="(w, i) in doc.who" :key="i">{{ w }}</p>
          </div>
          <div class="q">
            <h4>什么时候 · When</h4>
            <p>{{ doc.when }}</p>
          </div>
          <div class="q">
            <h4>交给谁 · Where</h4>
            <p>{{ doc.where }}</p>
          </div>
          <div class="q">
            <h4>怎么做对 · How</h4>
            <p v-for="(c2, i) in doc.how" :key="i">· {{ c2 }}</p>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.train {
  padding: 14px 22px 10px;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  flex: none;
}
.kick {
  font-size: var(--fs-kicker);
  letter-spacing: 1.2px;
  color: var(--seal);
  font-weight: 600;
}
.head h2 {
  margin: 0;
  font-size: var(--fs-card);
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--ink);
}
.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px 4px 8px;
  background: var(--paper-2);
  cursor: pointer;
  user-select: none;
}
.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.switch .track {
  width: 26px;
  height: 15px;
  border-radius: 999px;
  background: #dcd4c4;
  position: relative;
  transition: background 0.18s;
}
.switch .track i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(28, 27, 25, 0.25);
  transition: left 0.18s;
}
.switch input:checked + .track {
  background: var(--seal);
}
.switch input:checked + .track i {
  left: 13px;
}
.switch .label {
  font-size: var(--fs-sub);
  color: var(--ink-2);
}
.switch input:checked ~ .label {
  color: var(--seal);
}
.hint {
  margin-left: auto;
  font-size: var(--fs-sub);
  color: var(--ink-3);
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 12px;
}
.panel {
  background: var(--paper-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px;
  overflow: auto;
}
.chain {
  margin-bottom: 20px;
}
.chain:last-child {
  margin-bottom: 0;
}
.cname {
  font-size: var(--fs-sub);
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 9px;
}
.row {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 6px;
}
.node {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 9px 13px;
  min-width: 88px;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.node b {
  display: block;
  font-size: var(--fs-body);
  font-weight: 700;
  line-height: 1.3;
  color: var(--ink);
}
.node em {
  display: block;
  font-style: normal;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  margin-top: 5px;
  letter-spacing: 0.3px;
}
.node:hover {
  border-color: var(--ink-3);
}
.node.on {
  border-color: var(--seal);
  box-shadow: inset 0 0 0 1px var(--seal);
  background: #fff;
}
.node.on b {
  color: var(--seal);
}
.node.qc {
  border-style: dashed;
  border-color: #c3a9a6;
  background: transparent;
}
.node.qc b {
  color: var(--seal);
  opacity: 0.9;
}
.arw {
  color: var(--ink-3);
  font-size: var(--fs-body);
  display: flex;
  align-items: center;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dname {
  font-size: var(--fs-sub);
  font-weight: 700;
  color: var(--ink);
}
.q {
  border-left: 3px solid var(--seal);
  padding: 2px 0 2px 10px;
}
.q h4 {
  margin: 0 0 5px;
  font-size: var(--fs-xs);
  color: var(--seal);
  letter-spacing: 0.6px;
  font-weight: 700;
}
.q p {
  margin: 0 0 3px;
  font-size: var(--fs-sub);
  line-height: 1.72;
  color: var(--ink-2);
}
.q p:last-child {
  margin-bottom: 0;
}
</style>