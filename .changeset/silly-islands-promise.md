---
'@electric-sql/pglite-sync': patch
---

New `initialInsertMethod` option that can specify `insert`, `csv` or `json` as the method used to handle the initial sync. The supersedes the `useCopy` option which is now deprecated and will be removed in a future version.
