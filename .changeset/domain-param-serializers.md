---
'@electric-sql/pglite': patch
---

Serialize params of a domain type with the serializer of its base type, also for domains created after init and arrays of domains. A `Uint8Array` or `Buffer` bound to a domain over `bytea` was written with `toString()` and stored as the wrong bytes.
