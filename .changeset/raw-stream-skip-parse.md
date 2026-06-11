---
'@electric-sql/pglite': patch
---

Skip the internal wire-protocol parse during `execProtocolRawStream()` when
no notification listeners are registered. The parse runs synchronously in
the WASM write callback and eagerly decodes every DataRow field, roughly
doubling the latency of raw-stream queries; on the raw path it is
load-bearing only for LISTEN/NOTIFY dispatch.
