import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite-sync',
    dir: './test',
    watch: false,
    typecheck: { enabled: true },
    testTimeout: 30000,
    hookTimeout: 30000,
    restoreMocks: true,
    testTransformMode: {
      ssr: ['**/*'],
    },
  },
})
