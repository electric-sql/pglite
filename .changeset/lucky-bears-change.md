---
'@electric-sql/pglite': patch
---

Fix `incrementalQuery` and `changes` APIs not working when keyed on non-integer primary keys like `TEXT` and `UUID`.
