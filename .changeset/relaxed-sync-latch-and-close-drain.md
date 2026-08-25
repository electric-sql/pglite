---
'@electric-sql/pglite': patch
---

Fix two ways a `relaxedDurability` database could silently lose persistence:

- A failed fire-and-forget background sync was an unhandled promise rejection and the database kept running without ever persisting again. The first failure is now latched and thrown by the next query or explicit `syncToFs()` call.
- `close()` could close the filesystem while a fire-and-forget sync was still running against it — on IdbFs this opened a transaction on an already-closing IndexedDB connection (an uncaught `InvalidStateError` from inside an Emscripten callback, reproduced on Chrome and Firefox) and the tail writes could be dropped. `close()` now drains any in-flight sync and performs a final strict sync before closing the filesystem, and reports a final-sync failure after releasing filesystem resources.
