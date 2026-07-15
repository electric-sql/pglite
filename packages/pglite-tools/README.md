# pglite-tools

A selection of tools for working with [PGlite](https://github.com/electric-sql/pglite) databases, including pg_dump.

Install with:

```bash
npm install @electric-sql/pglite-tools
```

## Native-style Node runners

The Node-only runners preserve PostgreSQL argv, environment, streaming stdio,
exit status, and cancellation semantics. Client programs connect through
libpq to a TCP or Unix-socket PGlite server; they do not use an in-process
`PGlite` protocol stream.

```typescript
import { pgIsReady } from '@electric-sql/pglite-tools/pg_isready'
import { runPgDump } from '@electric-sql/pglite-tools/pg_dump/native'
import { runPgRestore } from '@electric-sql/pglite-tools/pg_restore'
import { runPsql } from '@electric-sql/pglite-tools/psql'
import {
  runCreateDb,
  runCreateUser,
  runDropDb,
  runDropUser,
} from '@electric-sql/pglite-tools/admin'

const invocation = {
  argv: ['-h', '127.0.0.1', '-p', '5432'],
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

const readiness = await pgIsReady(invocation)
const dump = await runPgDump(invocation)
const query = await runPsql({
  ...invocation,
  argv: [...invocation.argv, '-c', 'select current_database()'],
})
```

Each invocation creates fresh Wasm process state in a Worker. A file URL or
path supplied as `cwd` is mounted through NODEFS, as are absolute `HOME`,
`PGPASSFILE`, `PGSERVICEFILE`, and `PGSYSCONFDIR` locations.

The native-style set contains `psql`, `pg_dump`, `pg_restore`, `pg_isready`,
`createdb`, `createuser`, `dropdb`, `dropuser`, `clusterdb`, `vacuumdb`, and
`reindexdb`. Each named export has a `PostgresToolRunner` form as well as its
`run*` convenience function. These are PostgreSQL programs compiled without
SSL, GSS, LDAP, or readline. Parallel dump and restore modes and operations
that launch host programs are not supported; use one job. Files must be under
the mounted working directory or one of the mounted environment paths above.

### Installed artifact cost

Each command has independent Emscripten glue and Wasm so that every invocation
owns fresh process state. These are the release artifact sizes for the current
PostgreSQL 18 / Emscripten 3.1.74 build; gzip is measured per file and summed
for each command.

| Command      | Raw JS + Wasm | Gzip JS + Wasm |
| ------------ | ------------: | -------------: |
| `pg_dump`    |     858,347 B |      306,048 B |
| `pg_isready` |     461,744 B |      162,477 B |
| `psql`       |     919,556 B |      303,832 B |
| `pg_restore` |     639,707 B |      229,859 B |
| `createdb`   |     479,003 B |      170,275 B |
| `createuser` |     482,655 B |      172,099 B |
| `dropdb`     |     474,810 B |      168,866 B |
| `dropuser`   |     474,607 B |      168,833 B |
| `clusterdb`  |     480,456 B |      171,441 B |
| `vacuumdb`   |     499,217 B |      176,307 B |
| `reindexdb`  |     489,640 B |      174,309 B |

The packed tools package is 8,633,615 bytes unpacked and 2,916,939 bytes as an
npm tarball. Rebuilds must update these measurements when artifact contents or
the command set changes.

Standalone Node initialization is available from
`@electric-sql/pglite-tools/initdb`. It uses native initdb defaults and writes
the PGlite cluster manifest after successful initialization.

## `pgDump`

pg_dump is a tool for dumping a PGlite database to a SQL file, this is a WASM build of pg_dump that can be used in a browser or other JavaScript environments. You can read more about pg_dump [in the Postgres docs](https://www.postgresql.org/docs/current/app-pgdump.html).

Note: pg_dump will execute `DEALLOCATE ALL;` after each dump. Since this is running on the same (single) connection, any prepared statements that you have made before running pg_dump will be affected.

### Options

- `pg`: A PGlite instance.
- `args`: An array of arguments to pass to pg_dump - see [pg_dump docs](https://www.postgresql.org/docs/current/app-pgdump.html) for more details.
- `fileName`: The name of the file to write the dump to, defaults to `dump.sql`.

There are a number of arguments that are automatically added to the end of the command, these are:

- `--inserts` - use inserts format for the output, this ensures that the dump can be restored by simply passing the output to `pg.exec()`.
- `-j 1` - concurrency level, set to 1 as multithreading isn't supported.
- `-f /tmp/out.sql` - the output file is always written to `/tmp/out.sql` in the virtual file system.
- `-U postgres` - use the postgres user is hard coded.

### Returns

- A `File` object containing the dump.

### Caveats

- After restoring a dump, you might want to set the same search path as the initial db.

### Example

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'

const pg = await PGlite.create()

// Create a table and insert some data
await pg.exec(`
  CREATE TABLE test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`)
await pg.exec(`
  INSERT INTO test (name) VALUES ('test');
`)

// store the current search path so it can be used in the restored db
const initialSearchPath = (
  await pg1.query<{ search_path: string }>('SHOW SEARCH_PATH;')
).rows[0].search_path

// Dump the database to a file
const dump = await pgDump({ pg })
// Get the dump text - used for restore
const dumpContent = await dump.text()

// Create a new database
const restoredPG = await PGlite.create()
// ... and restore it using the dump
await restoredPG.exec(dumpContent)

// optional - after importing, set search path back to the initial one
await restoredPG.exec(`SET search_path TO ${initialSearchPath};`)
```
