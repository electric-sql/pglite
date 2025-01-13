import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // @ts-ignore type mismsatch but works?
  plugins: [vue()],
  test: {
    name: 'pglite-vue',
    dir: './test',
    watch: false,
    environment: 'jsdom',
    setupFiles: ['test-setup.ts'],
    typecheck: { enabled: true },
    restoreMocks: true,
    testTimeout: 15000,
    testTransformMode: {
      ssr: ['**/*'],
    },
  },
})
