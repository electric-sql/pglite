---
'@electric-sql/pglite-socket': patch
---

Handle the `SSLRequest` startup packet per the PostgreSQL wire protocol: when SSL is not available, respond with `N` so the client may continue with a cleartext `StartupMessage`. See https://www.postgresql.org/docs/current/protocol-message-formats.html .
