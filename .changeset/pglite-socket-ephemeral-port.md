---
'@electric-sql/pglite-socket': patch
---

Pass the assigned TCP port in the child process's `DATABASE_URL` when `pglite-server` is started with `--port=0`.
