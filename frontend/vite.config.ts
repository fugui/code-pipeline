import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'pipeline',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.tsx',
        './menu': './src/menu.ts',
      },
      shared: ['react', 'react-dom', 'react-router-dom']
    })
  ],
  base: '/pipeline/',
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false
  },
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
