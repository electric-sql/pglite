---
'@electric-sql/pglite-socket': patch
---

Reply `N` to the PostgreSQL `SSLRequest` packet when SSL is not supported, preventing mis-parsing and hung connections from clients that probe TLS before `StartupMessage` (e.g. Navicat, libpq defaults).
