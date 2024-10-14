---
'@electric-sql/pglite': patch
---

Fix a bug in live.incrementalQuery where if it was set to `limit 1` it would return no rows
