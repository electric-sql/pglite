---
'@electric-sql/pglite-sync': patch
---

Change to do a `DELETE FROM` rather than a `TRUNCATE` on `must-refetch` so that custom merge logic can be applied with triggers.
