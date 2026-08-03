---
'@electric-sql/pglite': patch
---

Reset retained protocol parser state after a malformed backend message so later queries can recover.
