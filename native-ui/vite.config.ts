import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'NATIVE_UI_')
  return {
    root: 'native-ui',
    plugins: [react()],
    server: {
      port: 4174,
      proxy: {
        '/api': env.NATIVE_UI_API || 'http://127.0.0.1:8787',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
