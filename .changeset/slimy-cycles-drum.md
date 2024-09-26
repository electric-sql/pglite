---
'@electric-sql/pglite': patch
---

Fix a bug where Postgres would hang after a "DROP DATABASE" followed by an unclean shutdown and restart
