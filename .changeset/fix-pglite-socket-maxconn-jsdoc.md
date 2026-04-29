---
'@electric-sql/pglite-socket': patch
---

Fix `PGLiteSocketServer` `maxConnections` JSDoc default — the constructor defaults to `1` (matching the CLI default and help text); only the JSDoc claimed `100`.
