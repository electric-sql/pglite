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
When building for production, If using the Multi-tab Worker, you might encounter errors during build, related to workers being bundle in `iife` format, to resolve this, add/update the `worker.format` option inside `vite.config.js` to `es` (the default is iife)
```diff
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
+ worker: {
+   format: 'es',
-   rollupOptions: {
-     // no need to exclude pglite here
-   }
 }
})
```

When importing the worker in your script, use the recommended [?worker](https://vitejs.dev/guide/features#static-assets) import method from vite (Not in your `/public`) assets folder!
```diff
+ import PGWorker from './worker.js?worker'

// your main page
+ export const pglite = new PGliteWorker(
-   new Worker(new URL('./worker.js', document.baseURI), {
+   new PGWorker({
-    type: 'module',
     name: 'pglite-worker',
   }),
   {
    ...your options here
   }
  },
)
```

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
