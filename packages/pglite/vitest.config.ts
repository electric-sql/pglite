import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite',
    dir: './tests',
    watch: false,
    typecheck: { enabled: true },
    testTimeout: 30000,
    server: {
      deps: {
        external: [/\/tests\/targets\/web\//],
      },
    },
  },
})
