import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5174,
    strictPort: false,
    allowedHosts: true, // 允许任意Host（Cloudflare隧道需要）
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/audio': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },

  clearScreen: false,
})
