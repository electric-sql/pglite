import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite server tests',
    typecheck: { enabled: true },
    environment: 'node',
    testTimeout: 30_000,
    watch: false,
    dir: './tests',
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
  },
})
