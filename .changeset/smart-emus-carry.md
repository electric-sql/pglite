---
'@electric-sql/pglite-sync': patch
---

Add a `useCopy` option to `syncShapeToTable`, when `true` performs a `COPY TO` for the initial sync.
