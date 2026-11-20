---
'@electric-sql/pglite': patch
---

Sync the filesystem when a transaction ends. `transaction()` ran its `COMMIT` while the in-transaction flag still suppressed the sync after a statement, and cleared the flag only afterwards, so a committed transaction was not persisted (for example to IndexedDB with `idb://`) until some later query outside a transaction. The transaction now ends with one `syncToFs()`, after the `COMMIT` or the `ROLLBACK`, before it resolves.
