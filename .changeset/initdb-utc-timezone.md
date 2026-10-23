---
'@electric-sql/pglite': patch
---

Run initdb with `TZ=UTC`, like the backend, so a new database gets `timezone = 'UTC'` in `postgresql.conf`. Before, initdb wrote the host's zone as a fixed offset without daylight saving (e.g. `Etc/GMT+5` for America/New_York), so `timestamptz` input without an offset was stored at a different instant on each non-UTC machine.
