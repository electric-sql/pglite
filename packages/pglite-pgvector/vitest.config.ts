import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: {
      '@electric-sql/pglite-pgvector': new URL(
        './src/index.ts',
        import.meta.url,
      ).pathname,
    },
    globals: true,
    environment: 'node',
    testTimeout: 30000,
  },
})
