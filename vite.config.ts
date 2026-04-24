import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Pre-bundle Babylon packages upfront so Vite doesn't discover
    // hundreds of shader sub-imports mid-session (which causes hash
    // mismatches, 504 Outdated Optimize Dep, and white screens).
    include: [
      '@babylonjs/core',
      '@babylonjs/loaders/glTF',
      '@babylonjs/materials',
      '@babylonjs/gui',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@babylonjs/')) {
            return 'babylonjs'
          }

          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'react-vendor'
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    open: true,
    hmr: {
      overlay: true,
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
  preview: {
    open: true,
  },
})
