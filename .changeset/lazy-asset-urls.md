---
'@electric-sql/pglite': patch
---

Only build the `pglite.wasm`, `initdb.wasm` and `pglite.data` URLs when PGlite has to load them. Passing `pgliteWasmModule`, `initdbWasmModule` and `fsBundle` now works in bundles where `import.meta.url` is undefined, such as an esbuild IIFE build.
