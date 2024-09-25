---
'@electric-sql/pglite-sync': patch
---

Commit `ShapeStream` message batches transactionally.
Implement `shapeKey` option to `syncShapeToTable` to persist stream.
Implement `metadataSchema` option to `electricSync` configuration to specify where stream metadata is peristed.
Implement in-memory lock to disallow multiple shapes on single table.
Fix `must-refetch` handling by truncating underlying table on refetch.
[BREAKING] Move `ShapeStreamOptions` as separate property of `SyncShapeToTableOptions` rather than extension