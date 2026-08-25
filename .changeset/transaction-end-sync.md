---
'@electric-sql/pglite': patch
---

Sync to the filesystem when a transaction ends. `transaction()` executed its terminal `COMMIT`/`ROLLBACK` while the in-transaction flag still suppressed the per-exec `syncToFs()`, and cleared the flag only afterwards — so a resolved `transaction()` had neither performed nor scheduled any filesystem sync, and a committed transaction was not persisted until some later unrelated query ran. The transaction now ends with the same synchronization as a top-level exec, on every terminal path: commit, rollback, explicit `tx.rollback()` (whether the callback then returns or throws), and a terminal `COMMIT` that itself fails (e.g. a deferred constraint violation). A failure in that final sync never masks the transaction's own error.
