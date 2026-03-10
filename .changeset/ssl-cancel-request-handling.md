---
'@electric-sql/pglite-socket': minor
---

Handle SSLRequest and CancelRequest wire protocol messages for proxy compatibility

Added support for PostgreSQL SSLRequest and CancelRequest protocol messages that arrive during the connection startup phase. SSLRequest is answered with 'N' (no SSL), and CancelRequest is silently acknowledged. This enables pglite-socket to work behind connection proxies like Cloudflare Hyperdrive that send SSLRequest during connection negotiation.
