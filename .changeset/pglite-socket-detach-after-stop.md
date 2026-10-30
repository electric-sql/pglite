---
'@electric-sql/pglite-socket': patch
---

Stop a handler that `stop()` already detached from touching the database again. A client socket that closed in the same event-loop turn as `stop()` queued its own detach, which ran after `db.close()` and failed with an unhandled `TypeError: Cannot read properties of undefined (reading '_IsTransactionBlock')`.
