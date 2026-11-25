---
'@electric-sql/pglite': patch
---

Fix `idb://` not persisting a file truncate (e.g. after `DELETE` + `VACUUM`) by updating the node mtime on truncate so IDBFS writes it back
