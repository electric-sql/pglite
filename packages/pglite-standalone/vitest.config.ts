import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        // the standalone module uses native wasm exception handling (exnref)
        execArgv: ['--experimental-wasm-exnref'],
      },
    },
  },
})
