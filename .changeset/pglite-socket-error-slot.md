---
'@electric-sql/pglite-socket': patch
---

Release a connection slot when its handler ends in an error (for example `ECONNRESET` or an idle timeout). Previously only a clean `close` removed the handler, so `maxConnections` filled up and new connections were refused until the server restarted.
