---
'@electric-sql/pglite': patch
---

Quote the key column in `live.incrementalQuery` and `live.changes`, so a mixed-case key such as `"userId"` works
