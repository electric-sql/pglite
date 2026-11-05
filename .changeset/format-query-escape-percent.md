---
'@electric-sql/pglite': patch
---

Fix `formatQuery` (used by `live.query` and `live.incrementalQuery` to inline parameters) passing literal `%` characters in the query straight to Postgres' `format()`. A parameterised live query containing a `%`, such as `WHERE name LIKE $1 || '%'`, failed with `unrecognized format() type specifier`, and text such as `'%s'` or `'%1$I'` was silently replaced with a parameter value. Literal `%` is now escaped as `%%` before the `$n` placeholders are rewritten.
