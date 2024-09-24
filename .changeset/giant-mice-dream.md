---
'@electric-sql/pglite': patch
---

Add wasmModule and fsBundle options to manually load the WASM module and FS bundle. Additionally cache the WASM module and FS bundle after the first download for a speedup on subsequent calls.
