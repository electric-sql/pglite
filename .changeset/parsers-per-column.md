---
'@electric-sql/pglite': patch
---

Resolve one parser per column instead of copying the instance's parsers for every query with its own `parsers`, so a `Proxy` can supply them
