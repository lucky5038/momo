<script setup lang="ts">
const version = '0.1.0'
const backend = '待接入（现有后端 app.js 在 127.0.0.1:8787）'
</script>

<template>
  <main class="wrap">
    <h1>N-B助手</h1>
    <p class="sub">前端工程化骨架 · Vue 3 + Vite + TypeScript</p>
    <ul>
      <li>渲染层版本：{{ version }}</li>
      <li>后端接口：{{ backend }}</li>
      <li>状态：骨架验证页，尚未接入 Electron 窗口</li>
    </ul>
    <p class="tip">本页仅用于验证构建链路，现有界面与后端未做任何改动。</p>
  </main>
</template>

<style scoped>
.wrap {
  font-family: "Microsoft YaHei", system-ui, sans-serif;
  max-width: 720px;
  margin: 80px auto;
  padding: 0 24px;
  color: #1f2937;
}
h1 {
  font-size: 28px;
  margin-bottom: 8px;
}
.sub {
  color: #6b7280;
  margin-bottom: 24px;
}
ul {
  line-height: 2;
}
.tip {
  margin-top: 24px;
  padding: 12px 16px;
  background: #f3f4f6;
  border-radius: 8px;
  color: #6b7280;
  font-size: 13px;
}
</style>
