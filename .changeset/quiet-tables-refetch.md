---
'@electric-sql/pglite-sync': patch
---

Fix `must-refetch` handling in `syncShapesToTables`: the truncation of a refetched table is no longer committed on its own (the table keeps its rows until every shape has caught up, then truncation and refetched rows commit in one transaction), a `must-refetch` arriving while a commit is queued no longer truncates under that commit, and a failed commit now stops the subscription and is reported through `onError` instead of becoming an unhandled rejection.
