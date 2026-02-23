---
"@electric-sql/pglite-sync": patch
---

Fix move-in messages from tagged_subqueries not being synced

This fixes two issues with move-in messages from Electric's `tagged_subqueries` feature:

1. **LSN filtering bypass**: Move-in messages don't include an LSN header because they originate from direct database queries rather than the PostgreSQL replication stream. Previously, these messages were being filtered out as "already seen" because the missing LSN defaulted to 0. This fix checks for the `is_move_in` header and bypasses LSN filtering for these messages.

2. **Duplicate key handling**: Move-in data can overlap with data from the initial sync (e.g., when a row "moves in" to match a subquery that it already matched during initial sync). This fix uses `ON CONFLICT DO UPDATE` for move-in inserts to handle these duplicates gracefully, updating the row with the latest data instead of erroring.
