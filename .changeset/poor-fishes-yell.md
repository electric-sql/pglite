---
'@electric-sql/pglite': patch
---

Fix `PGliteWorker` hanging forever on a statement that was in flight when leadership moved. Such a statement now rejects with `LeaderChangedError`, as a statement queued behind it already did.
