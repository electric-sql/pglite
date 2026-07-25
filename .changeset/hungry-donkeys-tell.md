---
'@electric-sql/pglite': patch
---

Expose the fields node-postgres derives from the CommandComplete command tag on `Results`: `command` (e.g. `SELECT`, `INSERT`, `CREATE`), and `rowCount` (the per-statement count from the tag). The tag was already received and parsed internally to compute `affectedRows`, but these values were not surfaced. Matching node-postgres' `command`/`rowCount` result fields lets pg-compatible adapters report them without re-parsing SQL.
