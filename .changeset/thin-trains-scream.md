---
'@electric-sql/pglite-react': patch
'@electric-sql/pglite': patch
---

Add a `offset` and `limit` option to live queries, when used it will return the total count for the query along with efficient updating of the offset. This works well with windowed or virtualised scrolling components.
