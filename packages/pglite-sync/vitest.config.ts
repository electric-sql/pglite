import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite-sync',
    dir: './test',
    watch: false,
    typecheck: { enabled: true },
    restoreMocks: true,
    testTransformMode: {
      ssr: ['**/*'],
    },
  },
})
