<script setup lang="ts">
import { useRoute } from 'vue-router'
import { MODULES, APP_VERSION } from '../config/app'
import appIcon from '../assets/app-icon.png'

const route = useRoute()
const isActive = (path: string) => route.path === path
// 旧界面侧栏分「工作台 / 规划中」两组，规划中的模块排在后面
const plannedModules = MODULES.filter((m) => !!m.planned)
const mainModules = MODULES.filter((m) => !m.planned)
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <img class="app-icon" :src="appIcon" alt="N-B助手" />
      <div class="brand-text">
        <strong>N-B助手</strong>
        <small>让ERP在中国普遍成功</small>
      </div>
    </div>

    <nav class="nav">
      <div class="nav-group">工作台</div>
      <RouterLink
        v-for="m in mainModules"
        :key="m.key"
        :to="m.path"
        class="nav-item"
        :class="{ active: isActive(m.path) }"
      >
        <span class="nav-icon">{{ m.icon }}</span>
        <span class="nav-title">{{ m.title }}</span>
      </RouterLink>
      <div v-if="plannedModules.length" class="nav-group">规划中</div>
      <RouterLink
        v-for="m in plannedModules"
        :key="m.key"
        :to="m.path"
        class="nav-item"
        :class="{ active: isActive(m.path) }"
      >
        <span class="nav-icon">{{ m.icon }}</span>
        <span class="nav-title">{{ m.title }}</span>
      </RouterLink>
    </nav>

    <div class="foot">
      <span class="ver">v{{ APP_VERSION }}</span>
      <span class="tip">目标先选，来源后选；执行前自动备份。</span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--paper-3);
  border-right: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 16px;
  background: var(--paper);
  -webkit-app-region: drag;
}

.app-icon {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  object-fit: cover;
  box-shadow: var(--shadow-sm);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brand-text strong {
  font-family: var(--font-title);
  font-size: var(--fs-brand);
  letter-spacing: 1px;
}

.brand-text small {
  font-size: var(--fs-kicker);
  color: var(--ink-3);
  letter-spacing: 0.3px;
}

.nav {
  flex: 1;
  overflow-y: auto;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;gap: 9px;
  padding: 9px 10px;
  border-radius: var(--radius);
  color: var(--ink-2);
  border-left: 2px solid transparent;
  transition: background 0.12s ease, color 0.12s ease;
}

.nav-item:hover {
  background: var(--wash);
  color: var(--ink);
}

.nav-item.active {
  background: var(--seal-wash);
  border-left-color: var(--seal);
  color: var(--seal-deep);
  font-weight: 600;
}

.nav-icon {
  font-size: var(--fs-section);
  width: 18px;
  text-align: center;
  /* emoji 自带彩色，统一压成墨色，避免和纸墨底打架 */
  filter: grayscale(1) opacity(0.72);
}

.nav-title {
  font-size: var(--fs-body);
  letter-spacing: 0.4px;
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--line-soft);
}

.ver {
  font-size: var(--fs-xs);
  color: var(--ink-2);
  font-family: Consolas, monospace;
}

.nav-group {
  margin: 10px 0 4px;
  padding: 0 18px;
  font-size: var(--fs-kicker);
  letter-spacing: 1.2px;
  color: var(--ink-3);
}

.tip {
  font-size: var(--fs-kicker);
  color: var(--ink-3);
  line-height: 1.4;
}

.ver-note {
  font-size: var(--fs-kicker);
  color: var(--ink-3);
}
</style>
