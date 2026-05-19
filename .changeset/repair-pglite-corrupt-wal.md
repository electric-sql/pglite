---
'@electric-sql/pglite': patch
---

Recover NodeFS data directories from corrupt WAL/checkpoint startup failures by resetting WAL in place and retrying startup once, preserving existing data files instead of requiring a fresh database.
