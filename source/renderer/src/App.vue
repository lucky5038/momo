<script setup lang="ts">
import { onMounted } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import { useAppStore } from './stores/app'

const store = useAppStore()

onMounted(() => {
  // 先出界面（读本地配置很快），再后台真探活一次：数据库不通时顶栏会变红并给出原因
  void store.checkConnection().then(() => store.probe())
})
</script>

<template>
  <div class="shell">
    <AppSidebar />
    <div class="main">
      <AppTopbar />
      <main class="content">
        <p class="slogan">科技不是高高在上，而是服务于人民</p>
        <RouterView />
      </main>
    </div>
    <!-- 标题栏下的一条横线：整条画在 overlay 区域之外，不然右侧系统按钮那一截会被盖掉 -->
    <div class="titlebar-rule" />
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  display: grid;
  grid-template-columns: 212px minmax(0, 1fr);
  height: 100%;
  overflow: hidden;
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

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 22px 28px;
}

/* 旧界面 <main> 首行的题记，保留 */
.slogan {
  margin: 0;
  padding: 12px 0 8px;
  text-align: center;
  font-size: var(--fs-body);
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--ink-3);
}
</style>
