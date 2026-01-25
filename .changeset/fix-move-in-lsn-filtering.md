---
"@electric-sql/pglite-sync": patch
---

Fix move-in messages being incorrectly skipped due to LSN filtering

Move-in messages from Electric's tagged_subqueries feature don't include an LSN header because they originate from direct database queries rather than the PostgreSQL replication stream. Previously, these messages were being filtered out as "already seen" because the missing LSN defaulted to 0, which was less than or equal to the last committed LSN.

This fix checks for the `is_move_in` header and bypasses LSN filtering for move-in messages, ensuring that rows moving into a shape due to subquery condition changes are properly synced to the client.
