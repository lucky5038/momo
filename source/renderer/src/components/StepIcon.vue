<script setup lang="ts">
/** 十步封面图标：统一 24 网格、1.3 描边、只用 currentColor，跟随主题取色 */
defineProps<{ name: string }>()

const ICONS: Record<string, string> = {
  // 01 启动：播放圆环
  start: '<circle cx="12" cy="12" r="9"/><path d="M10 8.4l6.2 3.6-6.2 3.6z"/>',
  // 02 安装：齿轮辐条
  install:
    '<circle cx="12" cy="12" r="3.4"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  // 03 编码：两表 + 传递箭头
  coding:
    '<rect x="2.5" y="5" width="7.2" height="14" rx="1.6"/><rect x="14.3" y="5" width="7.2" height="14" rx="1.6"/><path d="M9.9 12h4.1"/><path d="M12.6 10l1.6 2-1.6 2"/>',
  // 04 调研：放大镜看文档
  survey:
    '<circle cx="10.8" cy="10.8" r="6.2"/><path d="M15.4 15.4L20.2 20.2"/><path d="M8.2 9.2h5M8.2 12h3.4"/>',
  // 05 培训：白板 + 人
  training:
    '<rect x="2.8" y="4.2" width="12.6" height="9.6" rx="1.6"/><circle cx="19" cy="9.6" r="2.1"/><path d="M15.6 16.2c0-2.2 1.6-3.4 3.4-3.4s3.4 1.2 3.4 3.4"/><path d="M8.9 7.2v3.4"/>',
  // 06 模拟：虚线框 + 播放
  simulate:
    '<rect x="2.8" y="5" width="18.4" height="14" rx="2" stroke-dasharray="3 2.4"/><path d="M10 9.4l5.2 2.6-5.2 2.6z"/>',
  // 07 期初：表格 + 上传
  opening:
    '<rect x="2.8" y="4.6" width="18.4" height="14.8" rx="1.8"/><path d="M2.8 9.4h18.4M8.6 9.4v10"/><path d="M17.2 13v5.4M15 15.4l2.2-2.4 2.2 2.4"/>',
  // 08 上线会议：两个对话气泡
  meeting: '<path d="M3 5.4h10.2v6.6H7.4L3 15.4z"/><path d="M12.6 9h8.4v6.4h-3l-3.6 3z"/>',
  // 09 检查：勾选清单
  inspect:
    '<rect x="4.2" y="2.8" width="15.6" height="18.4" rx="2"/><path d="M7.8 8.4l1.8 1.8 3.4-3.4"/><path d="M7.8 14h8M7.8 17.2h5"/>',
  // 10 结案：虚线印章 + 对勾
  close: '<circle cx="12" cy="12" r="8.4" stroke-dasharray="2.4 2.4"/><path d="M8.6 12.2l2.4 2.4 4.6-5"/>',
}
</script>

<template>
  <!-- 内容全部来自本文件内的常量，不涉及外部输入 -->
  <svg class="step-ico" viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS[name] ?? ''" />
</template>

<style scoped>
.step-ico {
  width: 82px;
  height: 82px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
