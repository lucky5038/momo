import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 开发态：Vite 起前端，/api 代理到后端 app.js（Electron 内或其他进程起的 8787）。
// 生产态：由 app.js 直接静态服务 build 出的 dist，同源，/api 相对路径不变。
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // 编辑器/工具的原子写会生成 .xxx.tmpdir 临时目录，chokidar 去 watch 会报 EBUSY 直接把 Vite 打死
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.*.tmpdir/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
