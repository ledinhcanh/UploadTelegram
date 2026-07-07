import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'events', 'crypto', 'path', 'stream', 'util', 'os', 'net'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
})
