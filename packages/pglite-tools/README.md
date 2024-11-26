# pglite-tools

A selection of tools for working with [PGlite](https://github.com/electric-sql/pglite) databases, including pg_dump.

Install with:

```bash
npm install @electric-sql/pglite-tools
```

## `pgDump`

pg_dump is a tool for dumping a PGlite database to a SQL file, this is a WASM build of pg_dump that can be used in a browser or other JavaScript environments. You can read more about pg_dump [in the Postgres docs](https://www.postgresql.org/docs/current/app-pgdump.html).

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

// Dump the database to a file
const dump = await pgDump({ pg })
```
