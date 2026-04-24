import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/GovernCrypto-extension/',
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sign: resolve(__dirname, 'sign.html')
      }
    }
  }
})