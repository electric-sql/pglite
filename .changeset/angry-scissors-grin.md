---
'@electric-sql/pglite': patch
---

New `runExclusive` method on PGlite that allows you to hold an exclusive lock on the database, for use with `execProtocol*` methods
