import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import { versionTrackerPlugin } from '../../code-common/build-utils/versionTrackerPlugin'


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    versionTrackerPlugin({ appName: 'code-pipeline' }),
    federation({
      name: 'pipeline',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.tsx',
        './menu': './src/menu.ts',
      },
      shared: ['react', 'react-dom', 'react-router-dom'],
    }),
  ],
  base: '/pipeline/',
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
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
      },
    },
  },
})
