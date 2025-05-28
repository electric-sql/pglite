# pglite-tools

A selection of tools for working with [PGlite](https://github.com/electric-sql/pglite) databases, including pg_dump.

Install with:

```bash
npm install @electric-sql/pglite-tools
```

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
const initialSearchPath = (await pg1.query<{ search_path: string }>('SHOW SEARCH_PATH;')).rows[0].search_path

// Dump the database to a file
const dump = await pgDump({ pg })
// Get the dump text - used for restore
const dumpContent = await dump.text()

// Create a new database 
const restoredPG = await PGlite.create()
// ... and restore it using the dump
await restoredPG.exec(dumpContent)

// optional - after importing, set search path back to the initial one
await restoredPG.exec(`SET search_path TO ${initialSearchPath};`);
```
