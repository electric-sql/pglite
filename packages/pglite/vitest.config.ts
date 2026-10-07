import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'

export default defineConfig({
  plugins: [
    {
      // Minimal stand-in for unwasm's `?module` imports, used by `dist/unwasm.js`
      name: 'wasm-module',
      load(id) {
        if (id.endsWith('.wasm?module')) {
          const source = readFileSync(id.slice(0, -'?module'.length))
          return `export default new WebAssembly.Module(Buffer.from(${JSON.stringify(source.toString('base64'))}, 'base64'))`
        }
      },
    },
  ],
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
