---
'@electric-sql/pglite-sync': patch
---

Fix the COPY-based initial sync (`initialInsertMethod: 'csv'` / `useCopy`) to serialize rows using PostgreSQL's own COPY TEXT format. The previous ad-hoc CSV encoding broke on many types (arrays became `1,2,3` instead of `{1,2,3}`, `json`/`jsonb` became `[object Object]`, and embedded delimiters/newlines/backslashes were mishandled). The new serializer is a faithful port of the backend's `CopyAttributeOutText` (copyto.c) and `array_out` (arrayfuncs.c) routines, so booleans, numbers, bigints, arrays (incl. multi-dimensional), `json`/`jsonb`, `bytea`, timestamps and arbitrary strings now round-trip correctly through `COPY ... FROM`.
