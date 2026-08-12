---
'@electric-sql/pglite': patch
---

Fix `formatQuery` (used by `live.query`/`live.incrementalQuery` to inline parameters) emitting `%NL` instead of the positional `%N$L` format specifier. A bare `%NL` is "min width N" and consumes `format()` arguments sequentially, so placeholders that are out of textual order silently bound the wrong values, and repeated placeholders failed with `too few arguments for format()`.
