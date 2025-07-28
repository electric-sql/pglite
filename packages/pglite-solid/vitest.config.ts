import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  test: {
    name: 'pglite-solid',
    dir: './test',
    watch: false,
    environment: 'jsdom',
    setupFiles: ['test-setup.ts'],
    typecheck: { enabled: true },
    restoreMocks: true,
    testTimeout: 15000,
    testTransformMode: {
      ssr: ['**/*'],
    },
  },
})
