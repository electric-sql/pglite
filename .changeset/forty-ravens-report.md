---
'@electric-sql/pglite': patch
---

Fix an issue where the protocol ready-for-query message was not returned after an error when using execProtocol.
