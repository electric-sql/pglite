---
'@electric-sql/pglite': patch
---

Fix `date` / `timestamp` / `timestamptz` values with a year before 100 being parsed as 19xx/20xx. PostgreSQL emits such years as e.g. `0050-06-15 12:30:00+00`, which is not strict ISO 8601, so `new Date()` fell back to its legacy parser and mapped the year into the 1900s (or returned `Invalid Date`). For example `0050` became `1950` and `0001` became `2015`. The text is now normalized to ISO 8601 before parsing; years 100 and above are unaffected.
