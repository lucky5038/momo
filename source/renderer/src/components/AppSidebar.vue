<script setup lang="ts">
import { useRoute } from 'vue-router'
import { MODULES, APP_VERSION } from '../config/app'
import appIcon from '../assets/app-icon.png'

const route = useRoute()
const isActive = (path: string) => route.path === path
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
      <RouterLink
        v-for="m in MODULES"
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
      <span class="ver-note">渲染层重构中</span>
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
  box-shadow: inset 0 0 0 1px rgba(28, 27, 25, 0.08);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brand-text strong {
  font-family: var(--font-title);
  font-size: 16px;
  letter-spacing: 1px;
}

.brand-text small {
  font-size: 11px;
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
  font-size: 15px;
  width: 18px;
  text-align: center;
  /* emoji 自带彩色，统一压成墨色，避免和纸墨底打架 */
  filter: grayscale(1) opacity(0.72);
}

.nav-title {
  font-size: 13.5px;
  letter-spacing: 0.4px;
}

.foot {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--line-soft);
}

.ver {
  font-size: 12px;
  color: var(--ink-2);
  font-family: Consolas, monospace;
}

.ver-note {
  font-size: 11px;
  color: var(--ink-3);
}
</style>
