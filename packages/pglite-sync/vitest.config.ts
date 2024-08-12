import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'pglite-react',
    dir: './test',
    watch: false,
    environment: 'jsdom',
    typecheck: { enabled: true },
    restoreMocks: true,
    testTransformMode: {
      ssr: ['**/*'],
    },
  },
})
