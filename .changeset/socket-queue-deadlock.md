---
'@electric-sql/pglite-socket': patch
---

Fix a permanent deadlock in the query queue: a single internal failure thrown while executing one query (e.g. a WASM abort or a race with `db.close()`) left the queue's `processing` flag stuck, so no further queries from any connection were ever processed. The queue now recovers and keeps serving queued queries (#1046).
