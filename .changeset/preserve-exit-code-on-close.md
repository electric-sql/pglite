---
'@electric-sql/pglite': patch
---

Preserve the host `process.exitCode` when closing a PGlite instance. `close()` calls `_emscripten_force_exit(0)`, whose Emscripten runtime sets `process.exitCode = 0`, clobbering any exit code the host process had already set. This mirrors the existing save/restore guards in `#init()` and `execProtocolRaw()`, so closing a database no longer silently resets the host process's exit code.
