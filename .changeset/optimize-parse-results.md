---
"@electric-sql/pglite": patch
---

Reduce per-row allocation overhead in `parseResults()` by hoisting field metadata once per result set and building rows with indexed loops instead of `Object.fromEntries` / `.map()`.
