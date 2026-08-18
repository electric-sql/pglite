# Upstream pgTAP spec files

The `.sql` files in this directory are verbatim, byte-identical copies of
[pg_partman](https://github.com/pgpartman/pg_partman)'s own pgTAP test suite
at tag `v5.5.0` (`test/*.sql` in that repository), under the
[PostgreSQL License](https://github.com/pgpartman/pg_partman/blob/master/LICENSE.txt).

They act as the behavioural spec for this port: `tests/pgtap-spec.test.ts`
executes each file against PGlite and fails on any `not ok` TAP line or plan
mismatch. The only transformation applied at runtime is stripping psql
meta-command lines (`\set ...`), which have no meaning outside psql.

To refresh after the pg_partman submodule in `postgres-pglite` is bumped
to a newer release: update `UPSTREAM_TAG` in `scripts/sync-pgtap-spec.ts`,
run `pnpm sync-pgtap-spec`, and update the version assertion in
`tests/pg_partman.test.ts`. That assertion fails whenever the bundled
extension version and this spec disagree, so the copies cannot go stale
silently. The
subset here is the portion of the upstream suite that needs no background
worker, no tablespaces, no sub-partitioning (which requires a raised
`max_locks_per_transaction`) and no procedure transaction control, so it runs
unchanged in a single PGlite session.
