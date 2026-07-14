import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 10 * 60 * 1000,
  },
})
