---
'@electric-sql/pglite': patch
---

`PGliteWorker` now sends the options of `execProtocol`, `execProtocolStream` and `execProtocolRaw` (`syncToFs`, `throwOnError`) to the worker, which dropped them. Every protocol message of a query therefore synced the filesystem, although the query syncs once at its end, which made `idb://` queries through a worker many times slower than on a direct instance. `onNotice` and the `onRawData` of `execProtocolRawStream`, which cannot be sent to a worker, are now called on the tab with what the worker returns, and `execProtocolRawStream` no longer fails with a `DataCloneError`.
