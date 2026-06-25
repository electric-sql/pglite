---
'@electric-sql/pglite-socket': patch
---

Handle PostgreSQL CancelRequest wire protocol messages

Added support for the CancelRequest message that some clients and connection proxies send during the connection startup phase. PGlite has no backend process to cancel, so the request is consumed and silently ignored (the protocol expects no response), which prevents it from being misinterpreted as a malformed startup/typed message. This complements the existing SSLRequest handling.
