# Bundler Support

Some bundlers require additional configuration to work with PGlite.

:::tip

If you come across any issues with PGlite and a specific bundler, please [open an issue](https://github.com/electric-sql/pglite/issues/new), we'd also love any contributions to this bundler documentation if you're able to help out.

:::

## Vite

When using [Vite](https://vitejs.dev/), make sure to add `optimizeDeps` inside `vite.config.js`:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
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
