---
'@electric-sql/pglite': patch
---

Restore a saved `process.exitCode` as an explicit `0` when it was `undefined`.

PGlite saves and restores `process.exitCode` around engine calls that may run
`proc_exit(XX)`. On a clean host the saved value is `undefined`, and under bun
`process.exitCode = undefined` is a no-op that leaves the current value in
place — so the restore silently failed and the engine's `proc_exit(99)` boot
sentinel survived, force-exiting an otherwise successful host process with code
99. `close()` previously masked this by calling `_emscripten_force_exit(0)`,
which set an explicit `0`; preserving the host exit code across `close()`
removed that incidental reset and exposed the bug on every lane.
