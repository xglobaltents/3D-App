import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    hmr: {
      overlay: true,
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
