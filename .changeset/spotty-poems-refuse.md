---
'@electric-sql/pglite': patch
---

Stop the `PGliteWorker` leader notify loop when the instance is closed. The loop announced the tab on the broadcast channel every 16ms until a leader connected. `close()` closed that channel but left the timer armed, so the next post threw an unhandled `InvalidStateError`.
