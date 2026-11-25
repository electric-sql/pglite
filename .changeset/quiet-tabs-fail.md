---
'@electric-sql/pglite': patch
---

Fix `PGliteWorker` hanging and flooding unhandled rejections when the worker's `init()` rejects. The leader now reports the failure to the tab, `waitReady` rejects with the original error, and the `tab-here` retry loop stops.
