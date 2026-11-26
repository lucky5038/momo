import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 独立构建：产物输出到 dist/，以后接入 Electron 时用 loadFile 指向 dist/index.html。
// base: './' 保证 file:// 加载时资源路径正确。
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
