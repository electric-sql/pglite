---
"@electric-sql/pglite": patch
---

Stop the PGliteWorker leader notify loop after close so it no longer posts to a closed BroadcastChannel
