---
'@electric-sql/pglite': patch
---

`close()` now waits for queries, execs and transactions that were issued before it, so they complete instead of failing with `Cannot read properties of undefined` after teardown.
