---
'@electric-sql/pglite': patch
---

Reject with `TransactionAbortedError` when committing an aborted transaction rolls it back instead of silently resolving.
