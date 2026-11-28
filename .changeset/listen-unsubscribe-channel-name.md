---
'@electric-sql/pglite': patch
---

Fix the unsubscribe function returned by `listen()` unsubscribing the normalized channel name instead of the name it was listened with, which made it fail with a syntax error on a quoted channel name holding a hyphen and left the listener registered on a mixed case quoted name
