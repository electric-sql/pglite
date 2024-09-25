---
'@electric-sql/pglite': patch
---

Fix quoting of table and channel names with the live plugin and listen method. Fixes issue where the live plugin would not work when the table names were camel case.
