import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    maxConcurrency: 1,
    name: 'pglite',
    dir: './tests',
    watch: false,
    typecheck: { enabled: true },
    testTimeout: 5000,
    hookTimeout: 30000,
    include: ['**/*.{test,test.web}.{js,ts}'],
    server: {
      deps: {
        external: [/\/tests\/targets\/web\//],
      },
    },
  },
})
