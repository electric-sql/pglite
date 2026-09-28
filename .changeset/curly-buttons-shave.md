---
'@electric-sql/pglite': patch
---

Support the `parsers` and `serializers` options on `PGliteWorker`. They were forwarded to the leader worker, where the structured clone algorithm rejected the functions they hold and `PGliteWorker.create()` failed with a `DataCloneError`. `PGliteWorker` now applies them on the thread that parses result rows, and no longer sends them to the worker.
