---
'@electric-sql/pglite-socket': minor
---

Add `PGLiteSocketServer.runOutsideTransaction()` to schedule internal database work through the socket queue without entering a client's open or aborted transaction. Wait for handler cleanup during server shutdown so pending internal work sees rolled-back client transactions.
