import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'integration tests',
    globals: true,
    typecheck: { enabled: true },
    environment: 'node',
    testTimeout: 30000,
    watch: false,
    dir: './tests',
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1 // because we are running a TCP server on a port 
  },
})
