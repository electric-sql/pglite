---
'@electric-sql/pglite-react': minor
---

Add a `usePGliteOptional` hook that returns `null` instead of throwing when no `PGliteProvider` is mounted, for lazy, async, or conditional database loading (issue #878). The string-query form of the live query hooks (`useLiveQuery`, `useLiveIncrementalQuery`) now tolerates a not-yet-mounted provider, returning `undefined` until one is available instead of throwing. The existing `usePGlite()` fail-fast behavior and its return type are unchanged.
