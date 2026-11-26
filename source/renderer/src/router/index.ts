import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import type { Component } from 'vue'
import { MODULES } from '../config/app'
import ModulePlaceholder from '../views/ModulePlaceholder.vue'
import CrossFillPage from '../views/CrossFillPage.vue'
import TriggersView from '../views/TriggersView.vue'
import SettingsView from '../views/SettingsView.vue'
import CleaningView from '../views/CleaningView.vue'

/** 已迁移完成的模块页面；没登记的仍走占位页 */
const PAGES: Record<string, Component> = {
  run: CrossFillPage,
  triggers: TriggersView,
  settings: SettingsView,
  cleaning: CleaningView,
}

/** 用 hash 路由：生产态由 app.js 兜底返回 index.html，hash 不参与后端路由判断，
 *  以后换成 history 模式时也只需改这一行。 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/run' },
  ...MODULES.map<RouteRecordRaw>((m) => ({
    path: m.path,
    name: m.key,
    component: PAGES[m.key] ?? ModulePlaceholder,
    meta: { title: m.title, desc: m.desc, icon: m.icon, stage: m.stage },
  })),
  { path: '/:pathMatch(.*)*', redirect: '/run' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
