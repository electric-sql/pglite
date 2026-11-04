---
'@electric-sql/pglite': patch
---

`syncToFs()` (and every `query()`/`exec()` that ends with it) no longer resolves early when another sync has been requested but has not started yet. It now waits for that queued sync, so with `relaxedDurability: false` a resolved call means its writes have been persisted. `relaxedDurability: true` is unchanged.
