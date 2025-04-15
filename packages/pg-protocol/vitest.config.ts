import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pg-protocol',
    dir: './test',
    watch: false,
    typecheck: { enabled: true },
    restoreMocks: true,
    testTimeout: 30000
  },
})
