---
'@electric-sql/pglite-utils': patch
'@electric-sql/pglite': patch
---

Use PROXYFS instead of dumping the data dir from the scratch PGlite used for initdb when the data dir is in memory.
