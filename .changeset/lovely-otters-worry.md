---
'@electric-sql/pglite-sync': minor
---

Support for multi shape transactional sync via a new `syncShapesToTables` api. This ensures that all changes from Postgres that were part of the same transaction are applied together as a single transaction to the local PGlite database.

Note: The `commitGranularity` and `commitThrottle` options have been removed due to incompatibility with the new transactional sync mechanism.
