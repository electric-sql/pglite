---
'@electric-sql/pglite': patch
---

Fail fast instead of hanging forever when opening an `opfs-ahp://` database with a broken pool. The pool-handle open in init and both maintainPool loops used async promise executors with no rejection path, so any `getFileHandle` or `createSyncAccessHandle` failure became an unhandled rejection and `Promise.all` never settled — the database wedged silently at startup. These are now proper async helpers whose errors propagate as a catchable error naming the failing operation and filename, with the original error preserved as `cause`.
