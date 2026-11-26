import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { MODULES } from '../config/app'
import ModulePlaceholder from '../views/ModulePlaceholder.vue'

/** 用 hash 路由：生产态由 app.js 兜底返回 index.html，hash 不参与后端路由判断，
 *  以后换成 history 模式时也只需改这一行。 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/run' },
  ...MODULES.map<RouteRecordRaw>((m) => ({
    path: m.path,
    name: m.key,
    component: ModulePlaceholder,
    meta: { title: m.title, desc: m.desc, icon: m.icon, stage: m.stage },
  })),
  { path: '/:pathMatch(.*)*', redirect: '/run' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
