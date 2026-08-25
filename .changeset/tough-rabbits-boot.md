---
'@electric-sql/pglite': patch
---

Allow initdb to complete in Node-shaped sandbox runtimes that reject writes to `process.exitCode`, preserve the host exit code, and release the Postgres module after close.
