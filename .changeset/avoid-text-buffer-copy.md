---
'@electric-sql/pg-protocol': patch
'@electric-sql/pglite': patch
---

Decode protocol text fields from a temporary byte view instead of allocating an intermediate buffer copy. Binary byte reads retain their existing owning-copy behavior.

Assemble borrowed protocol fragments directly into parser-owned storage instead of making an intermediate snapshot. Keep snapshots for aliased views and for inputs retained without a pending fragment.
