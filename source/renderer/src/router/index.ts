import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import CrossFillPage from '../views/CrossFillPage.vue'
import SettingsView from '../views/SettingsView.vue'
import CleaningView from '../views/CleaningView.vue'
import TrainingView from '../views/TrainingView.vue'
import ModulePlaceholder from '../views/ModulePlaceholder.vue'

/** 用 hash 路由：生产态由 app.js 兜底返回 index.html，hash 不参与后端路由判断，
 *  以后换成 history 模式时也只需改这一行。 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  {
    path: '/run',
    name: 'run',
    component: CrossFillPage,
    meta: { key: 'run', title: '带值', step: '03 编码' },
  },
  {
    path: '/cleaning',
    name: 'cleaning',
    component: CleaningView,
    meta: { key: 'cleaning', title: '数据清洗与导入', step: '07 期初' },
  },
  {
    path: '/training',
    name: 'training',
    component: TrainingView,
    meta: { key: 'training', title: '培训', step: '05 培训' },
  },
  {
    path: '/diagnose',
    name: 'diagnose',
    component: ModulePlaceholder,
    meta: { key: 'diagnose', title: '上线检查（数据体检）', step: '09 检查' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { key: 'settings', title: '系统设置' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
