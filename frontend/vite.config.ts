import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function versionTrackerPlugin(options: { appName?: string } = {}): Plugin {
  const getVersionData = () => {
    let gitHash = 'unknown'
    try {
      gitHash = execSync('git rev-parse --short HEAD').toString().trim()
    } catch {
      // 兼容无 Git 环境
    }

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const buildTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    const timestamp = now.getTime()

    return {
      appName: options.appName || 'code-pipeline',
      version: process.env.npm_package_version || '1.0.0',
      gitHash,
      buildTime,
      timestamp,
    }
  }

  const writeVersionFile = () => {
    try {
      const data = JSON.stringify(getVersionData(), null, 2)
      const publicDir = path.resolve(__dirname, 'public')
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true })
      }
      fs.writeFileSync(path.join(publicDir, 'version.json'), data)

      const distDir = path.resolve(__dirname, 'dist')
      if (fs.existsSync(distDir)) {
        fs.writeFileSync(path.join(distDir, 'version.json'), data)
      }
    } catch (e) {
      console.error('Failed to write version.json:', e)
    }
  }

  return {
    name: 'vite-plugin-version-tracker',
    buildStart() {
      writeVersionFile()
    },
    closeBundle() {
      writeVersionFile()
    },
  }
}

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
