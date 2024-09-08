---
'@electric-sql/pglite': patch
---

Refactor PGliteWorker so parsing happens on the main thread, fixes query options with custom parser
