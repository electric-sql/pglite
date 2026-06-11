---
'@electric-sql/pglite': patch
---

Stop accumulating parsed protocol messages into the internal results array
during `execProtocolRawStream()`. Raw-stream callers consume raw bytes via
`onRawData` and never read the parsed results, so the accumulation grew
unbounded until the next `execProtocol*` call reset it.
