---
'@electric-sql/pglite': patch
---

Support logical replication slots: start Postgres with `wal_level=logical` by default, export the symbols the `pgoutput` output plugin needs from the WASM main module, and surface unexpected WASM crashes as errors instead of silently corrupting the session.
