---
'@electric-sql/pglite': patch
---

Stop copying every default type parser on each `query()` and `exec()`. A query without `parsers` now uses the instance's parsers as is, and a query with `parsers` layers them over the instance's parsers by prototype. Parsing is unchanged; each call saves about 0.1 ms in Node.
