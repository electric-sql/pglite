import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite',
    dir: './tests',
    watch: false,
    typecheck: { enabled: true },
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['**/*.{test,test.web}.{js,ts}'],
    server: {
      deps: {
        external: [/\/tests\/targets\/web\//],
      },
    },
  },
})
