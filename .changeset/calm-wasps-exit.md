---
'@electric-sql/pglite': patch
---

Prevent `execProtocolRawSync` from spinning indefinitely when the Postgres WASM backend exits or crashes by rethrowing exceptions outside the database error longjmp path.
