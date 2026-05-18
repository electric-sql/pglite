# Bundler Support

Some bundlers require additional configuration to work with PGlite.

:::tip

If you come across any issues with PGlite and a specific bundler, please [open an issue](https://github.com/electric-sql/pglite/issues/new), we'd also love any contributions to this bundler documentation if you're able to help out.

:::

## Vite

When using [Vite](https://vitejs.dev/), make sure to exclude `pglite` from dependency optimization using the `optimizeDeps` option inside `vite.config.js`:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
```

### Additional configuration for the Multi-tab Worker

When using the Multi-tab Worker, you might encounter errors during a production build related to workers being bundle in `iife` format, to resolve this modify the `worker.format` option in `vite.config.js` to `'es'` (the default is `'iife'`)

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
})
```

When importing the worker in your script, you can use the recommended [?worker](https://vitejs.dev/guide/features#static-assets) import method from Vite:

```ts
import PGWorker from './worker.js?worker'

export const pglite = new PGliteWorker(
  new PGWorker({
    type: 'module',
      name: 'pglite-worker',
    }),
    {
      // ...your options here
    }
  },
)
```

## esbuild

[esbuild](https://esbuild.github.io/) does not support `new URL('./file', import.meta.url)` pattern that PGlite uses to locate its WebAssembly and data files. This means the automatic file resolution won't work out of the box.

### Workaround: manually provide `pgliteWasmModule`, `initdbWasmModule` and `fsBundle`

1. Copy `pglite.wasm`, `initdb.wasm` and `pglite.data` from `node_modules/@electric-sql/pglite/dist/` to your public/build directory so your web server can serve them.

2. Pass them manually when creating a PGlite instance:

```ts
import { PGlite } from '@electric-sql/pglite'

const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
  WebAssembly.compileStreaming(fetch('/pglite.wasm')),
  WebAssembly.compileStreaming(fetch('/initdb.wasm')),
  fetch('/pglite.data').then((response) => response.blob()),
])

const db = await PGlite.create({
  pgliteWasmModule,
  initdbWasmModule,
  fsBundle,
})
```

Alternatively, you can use an esbuild plugin like [`@chialab/esbuild-plugin-meta-url`](https://chialab.github.io/rna/guide/esbuild-plugin-meta-url) to handle `new URL()` imports automatically.

## Next.js

When using [Next.js](https://nextjs.org/), make sure to add `@electric-sql/pglite` to the `transpilePackages` array in `next.config.js`:

```js
const nextConfig = {
  swcMinify: false,
  transpilePackages: [
    '@electric-sql/pglite-react', // Optional
    '@electric-sql/pglite',
  ],
}

export default nextConfig
```
