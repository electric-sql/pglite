---
'@electric-sql/pg-protocol': patch
'@electric-sql/pglite': patch
---

Decode protocol text fields from a temporary byte view instead of allocating an intermediate buffer copy. Binary byte reads retain their existing owning-copy behavior.
