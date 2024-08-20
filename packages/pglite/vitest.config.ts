import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'pglite',
    dir: './tests',
    watch: false,
    typecheck: { enabled: true },
    // restoreMocks: true,
    // testTransformMode: {
    //   ssr: ['**/*'],
    // },
  },
})
