---
'@electric-sql/pglite': patch
---

Parse `infinity`, `-infinity`, BC dates and UTC offsets with seconds in `date`, `timestamp` and `timestamptz` values. They were `Invalid Date` before. Infinite values are now `Infinity` and `-Infinity`, and serialize back to `infinity` and `-infinity`.
