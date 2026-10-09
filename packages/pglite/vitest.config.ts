import { defineConfig } from 'vitest/config'

const timeout = Number(process.env.TEST_TIMEOUT) || 30000

export default defineConfig({
  test: {
    name: 'pglite',
    dir: './tests',
    watch: false,
    typecheck: { enabled: true },
    testTimeout: timeout,
    hookTimeout: timeout,
    include: ['**/*.{test,test.web}.{js,ts}'],
    server: {
      deps: {
        external: [/\/tests\/targets\/web\//],
      },
    },
  },
})
