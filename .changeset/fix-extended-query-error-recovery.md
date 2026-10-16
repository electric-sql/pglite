---
'@electric-sql/pglite': patch
---

Fix premature ReadyForQuery responses after extended-query errors, preventing PostgreSQL clients from desynchronizing before Sync.
