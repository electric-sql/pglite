# Bundler Support

Some bundlers require additional configuration to work with PGlite, due to the use of WebAssembly.

### Vite
When using Vite, make sure to add `optimizeDeps` inside `vite.config.js`:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
});
```
