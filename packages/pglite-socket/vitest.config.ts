import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'integration tests',
    globals: true,
    typecheck: { enabled: true },
    environment: 'node',
    testTimeout: 5000,
    watch: false,
    dir: './tests',
    maxConcurrency: 1 // because we are running a TCP server on a port 
  },
})
