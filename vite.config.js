import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
  server: { port: 5199, strictPort: true },
})
