import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    watch: false,
    setupFiles: ['./tests/setup.ts'],
  },
})
