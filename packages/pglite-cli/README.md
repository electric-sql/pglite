# `pglite`

The batteries-included Node distribution for PGlite. It combines the embedded
PGlite API, the multi-session postmaster, the Node socket server, and native-style
PostgreSQL command runners behind one executable and one set of imports.

Requires Node.js 22 or newer.

```sh
npx pglite initdb -D ./pgdata
npx pglite postgres -D ./pgdata -c listen_addresses=127.0.0.1 -p 5432
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
