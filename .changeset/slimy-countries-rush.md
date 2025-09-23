---
'@electric-sql/pglite': patch
---

initdb calls system to query the server configs. avoid that by hardcoding a return value of 123
