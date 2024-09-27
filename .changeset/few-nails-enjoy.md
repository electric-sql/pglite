---
'@electric-sql/pglite': patch
---

Fix an issue where extensions where given an oid in the builtin range and so skipped by pg_dump when run via pg_gateway #352
