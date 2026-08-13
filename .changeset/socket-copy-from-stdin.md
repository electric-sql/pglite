---
'@electric-sql/pglite-socket': patch
---

Fix COPY ... FROM STDIN over the socket server. The CopyData/CopyDone
messages that follow the query are now buffered and submitted to PGlite
together with the query as a single protocol call, instead of as separate
calls that desynchronized the connection and poisoned subsequent connects.
