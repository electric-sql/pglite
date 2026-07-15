# `pglite`

The batteries-included Node distribution for PGlite. It combines the embedded
PGlite API, the multi-session postmaster, the Node socket server, and native-style
PostgreSQL command runners behind one executable and one set of imports.

Requires Node.js 22 or newer.

```sh
npx pglite initdb -D ./pgdata
npx pglite postgres -D ./pgdata -c listen_addresses=127.0.0.1 -p 5432
```

In another process, the bundled PostgreSQL clients can use that listener:

```sh
npx pglite psql -h 127.0.0.1 -p 5432 postgres
npx pglite pg_dump -h 127.0.0.1 -p 5432 -Fc -f backup.dump postgres
npx pglite pg_restore -h 127.0.0.1 -p 5432 -d postgres backup.dump
```

`postgres` runs in the foreground and lets PostgreSQL resolve listener settings
from its command line and configuration files. `SIGTERM`, `SIGINT`, and
`SIGQUIT` request smart, fast, and immediate shutdown respectively; `SIGHUP`
reloads configuration. The command never initializes a data directory
implicitly.

For an explicitly configured PGlite-oriented listener, use:

```sh
npx pglite server -D ./pgdata --host 127.0.0.1 --port 5432
```

TCP defaults to loopback. Binding a non-loopback address emits a warning; access
is still governed by the cluster's PostgreSQL authentication configuration.

The package also re-exports the corresponding programmatic APIs:

```ts
import { PGlite } from 'pglite'
import { PGlitePostmaster } from 'pglite/postmaster'
import { PGliteServer } from 'pglite/server'
import { initdb, pgIsReady } from 'pglite/tools'
```

Use `@electric-sql/pglite` directly when you only need the embedded API. Use
`@electric-sql/pglite-server` directly when composing a Node socket frontend
around a postmaster. Browser multi-session hosting is intentionally outside the
scope of this Node distribution phase.

For Node filesystem implementations that require a Worker factory, set
`PGLITE_CONFIG` to a JavaScript module path. The module is explicitly trusted
application code and may default-export only the documented pluggable fields:

```js
import { readFile } from 'node:fs/promises'

/** @type {import('pglite').PGliteNodeConfiguration} */
export default {
  initdb: {
    icuDataDir: new Blob([await readFile('./icu-data.tar.gz')]),
  },
  postmaster: {
    workerFilesystem: {
      module: new URL('./filesystem.mjs', import.meta.url).href,
      options: {},
    },
  },
}
```

The initdb configuration supports only `icuDataDir`. The postmaster fields are
`artifact`, `fs`, `workerFilesystem`, `icuDataDir`, and `osUser`. Use the same
ICU archive for both when initializing a cluster that needs the complete ICU
collation inventory. Data-directory, PostgreSQL argument, listener, lifecycle,
and memory controls remain authoritative in the CLI and cannot be replaced by
the module. Loading a module executes it with the permissions of the `pglite`
process; do not use an untrusted path.

## PostgreSQL command compatibility

Arguments after a PostgreSQL-derived command are passed to that program
unchanged. Environment variables, streaming standard input/output, exit status,
and `SIGINT` cancellation are preserved.

| Command                                        | Compatibility and intentional differences                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initdb`                                       | Native defaults and argument meanings; Node filesystem paths only. Full ICU inventory can be supplied through `PGLITE_CONFIG`.                                       |
| `postgres`                                     | Foreground multi-session postmaster with PostgreSQL-controlled TCP and Unix listeners. No SSL, GSS, LDAP, forked logging collector, or daemon mode.                  |
| `server`                                       | PGlite-specific explicit listener frontend; this is not a native PostgreSQL command.                                                                                 |
| `pg_isready`                                   | Native connection options and exit statuses over TCP or Unix sockets.                                                                                                |
| `psql`                                         | SQL, scripts, variables, COPY streams, and meta-commands work. The build has no readline, tab completion, interactive line editing, pager process, or shell escapes. |
| `pg_dump`                                      | Plain, custom, tar, and directory output are available. Parallel jobs are unsupported; use `--jobs=1`.                                                               |
| `pg_restore`                                   | Restores supported archive formats. Parallel jobs are unsupported; use `--jobs=1`.                                                                                   |
| `createdb`, `createuser`, `dropdb`, `dropuser` | Native options and connection behavior. Interactive password input uses the invocation streams.                                                                      |
| `clusterdb`, `vacuumdb`, `reindexdb`           | Native options and database maintenance behavior; operations remain subject to the server's available extensions and build features.                                 |

The client programs are isolated in Workers and connect through Node's TCP or
Unix-socket host. They are compiled without SSL, GSS, LDAP, and host process
execution. Files are visible under the invocation working directory and the
absolute `HOME`, `PGPASSFILE`, `PGSERVICEFILE`, and `PGSYSCONFDIR` paths. A
relative output or archive path therefore resolves inside the current working
directory; arbitrary host paths are not implicitly mounted.

## Distribution size

The umbrella package contains only the CLI and re-export layer (about 26 KB as
an npm tarball). Its installed dependencies carry the implementation: the
current core tarball is about 22.0 MB compressed, the complete tools tarball is
about 2.92 MB, and the server wrapper is about 33 KB. Tool-by-tool raw and gzip
costs are published in the `@electric-sql/pglite-tools` README. Ordinary
`@electric-sql/pglite` root imports do not load the opt-in postmaster assets,
and core does not contain the client-tool artifacts.
