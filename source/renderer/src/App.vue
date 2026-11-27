<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppTopbar from './components/AppTopbar.vue'
import SetupWizard from './components/SetupWizard.vue'
import ToastHost from './components/ToastHost.vue'
import { api } from './api/client'
import { useAppStore } from './stores/app'

const store = useAppStore()
const route = useRoute()
// 旧版首次启动会强制走一遍连接向导；这里只在后端说 needsSetup 时才拦，老用户升级不打扰
const needsSetup = ref(false)

onMounted(async () => {
  try {
    const state = await api.onboarding()
    needsSetup.value = Boolean(state.needsSetup)
  } catch {
    needsSetup.value = false
  }
  if (needsSetup.value) return
  // 先出界面（读本地配置很快），再后台真探活一次：数据库不通时顶栏会变红并给出原因
  void store.checkConnection().then((ok) => { if (ok) void store.probe() })
})
</script>

<template>
  <SetupWizard v-if="needsSetup" />
  <div v-else class="shell">
    <AppTopbar v-if="route.path !== '/'" />
    <main class="content" :class="{ flush: route.path === '/' }">
      <div v-if="store.conn === 'error' && store.connError" class="conn-banner" role="alert">
        <span>数据库连接失败：{{ store.connError }}</span>
        <button class="btn sm" type="button" @click="store.reconnect()">重新连接</button>
      </div>
      <RouterView />
    </main>
    <!-- 标题栏下的一条横线：整条画在 overlay 区域之外，否则右侧系统按钮那一截会被盖掉 -->
    <div v-if="route.path !== '/'" class="titlebar-rule" />
  </div>
  <ToastHost v-if="!needsSetup" />
</template>

<style scoped>
.shell {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.conn-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 20px 0;
  padding: 7px 12px;
  font-size: var(--fs-sub);
  color: var(--err);
  background: var(--seal-wash);
  border: 1px solid var(--seal-line);
  border-radius: var(--radius);
}

.titlebar-rule {
  position: absolute;
  top: 52px;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
  pointer-events: none;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 20px 22px;
}

/* 主界面自己控制内边距，且要占满高度 */
.content.flush {
  padding: 0;
  overflow: hidden;
}
</style>
