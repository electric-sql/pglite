---
'@electric-sql/pglite': patch
---

Parse `infinity` and `-infinity` in `date`, `timestamp` and `timestamptz` values as `Infinity` and `-Infinity` instead of `Invalid Date`, and serialize them back to `infinity` and `-infinity`.
