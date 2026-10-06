---
'@electric-sql/pglite': patch
---

Prevent `close()` from hanging when called while a query or transaction is in
flight. Work started before `close()` is allowed to finish, while later
operations are rejected.
