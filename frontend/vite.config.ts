import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/pipeline/',
  server: {
    port: 5176,
    proxy: {
      '/pipeline/api': {
        target: 'http://192.168.56.18:8082',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://192.168.56.18:8082',
        changeOrigin: true,
      }
    }
  }
})
