import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // 开发模式下将 /api/* 请求代理到 Hermes 后端（玉瑶 · 太虚境）
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  // 防止在 Tauri 中因为清空屏幕闪烁
  clearScreen: false,
})
