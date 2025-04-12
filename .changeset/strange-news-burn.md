---
'@electric-sql/pglite': patch
---

Fix a race condition in live query unsubscription that could result in live queries failing to update.