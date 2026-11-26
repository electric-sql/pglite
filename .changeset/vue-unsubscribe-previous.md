---
'@electric-sql/pglite-vue': patch
---

Stop the previous live query when the query, params or key of `useLiveQuery` or `useLiveIncrementalQuery` change, so results of the old query no longer replace the current ones
