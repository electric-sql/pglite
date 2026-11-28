---
'@electric-sql/pglite-sync': patch
---

Upgrade `@electric-sql/client` to 1.5.28 and `@electric-sql/experimental` to 6.0.28. The `shape` options of `syncShapeToTable()` and `syncShapesToTables()` now accept the documented `liveSse` option (and the other options added to the client since 1.0.9). `experimentalLiveSse` still works but is deprecated by the client.
