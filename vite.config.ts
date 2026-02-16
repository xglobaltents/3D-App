import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks: {
          'babylonjs': [
            '@babylonjs/core',
            '@babylonjs/loaders',
            '@babylonjs/materials',
            '@babylonjs/gui',
            'react-babylonjs',
          ],
          'react-vendor': [
            'react',
            'react-dom',
          ],
        },
      },
    },
  },
  server: {
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
