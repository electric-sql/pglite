---
'@electric-sql/pglite': patch
---

Fix `PGlite.create({ fs })` on a fresh database calling the provided filesystem's `init()` twice: the inner initdb instance no longer inherits the user-provided `fs` and always runs on its own scratch filesystem. Previously any VFS holding exclusive resources (e.g. OPFS sync access handles) failed with a contention error on first create.
