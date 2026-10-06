---
'@electric-sql/pglite': patch
---

Fix a windowed `live.query` (one given `offset` and `limit`) leaking its `live_query_<id>_get_total_count` prepared statement on `unsubscribe`. Only `live_query_<id>_get` was deallocated, so the count statement survived every teardown while its backing view was dropped, accumulating dangling prepared statements for the lifetime of the database.
