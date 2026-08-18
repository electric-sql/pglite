# @electric-sql/pglite-pg_partman

[pg_partman](https://github.com/pgpartman/pg_partman) extension for
[PGlite](https://pglite.dev).

Automated creation and maintenance of time-based and serial-based table
partition sets, running entirely in the browser or Node via WASM.

## Installation

```bash
npm install @electric-sql/pglite-pg_partman
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pg_partman } from '@electric-sql/pglite-pg_partman'

const pg = new PGlite({
  extensions: {
    pg_partman,
  },
})

// pg_partman is not relocatable and is conventionally installed
// into its own schema
await pg.exec(`
  CREATE SCHEMA partman;
  CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
`)

// register a partitioned table with pg_partman
await pg.exec(`
  CREATE TABLE public.events (
    id int,
    payload text,
    created_at timestamptz NOT NULL DEFAULT now()
  ) PARTITION BY RANGE (created_at);

  SELECT partman.create_parent('public.events', 'created_at', '1 day');
`)

// periodically create new partitions / apply retention
await pg.exec('SELECT partman.run_maintenance();')
```

## Differences from pg_partman on a Postgres server

- **No background worker.** pg_partman's optional `pg_partman_bgw` scheduler
  is a Postgres background worker, which cannot exist in single-process WASM.
  This package ships the (officially supported) SQL-only build; the embedding
  application decides when to call `run_maintenance()`, for example from a
  timer.
- **Run your session in UTC.** pg_partman computes partition boundaries using
  the session timezone, and in a browser that defaults to the user's local
  timezone. Upstream strongly recommends UTC:
  `SET TIME ZONE 'UTC';`
- Procedures that manage their own transactions (`run_maintenance_proc()`,
  `partition_data_proc()`, ...) work when `CALL`ed outside a transaction
  block, but not inside `pg.transaction()`. The plain function equivalents
  (`run_maintenance()`, `partition_data_time()`, ...) work everywhere.

See the [pg_partman documentation](https://github.com/pgpartman/pg_partman/blob/master/doc/pg_partman.md)
for the full API.

## License

Apache-2.0
