import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite-utiles',
    dir: './test',
    watch: false,
    typecheck: { enabled: true },
    restoreMocks: true,
  },
})
