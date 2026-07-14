# `@electric-sql/pglite-server`

A Node.js TCP and Unix-domain socket server for multi-session PGlite.

```ts
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { PGliteServer } from '@electric-sql/pglite-server'

const postmaster = await PGlitePostmaster.create({ dataDir: './pgdata' })
const server = await PGliteServer.create({
  postmaster,
  listen: { host: '127.0.0.1', port: 5432 },
})

await server.close()
await postmaster.close()
```

The caller-owned form above closes only the server's listeners and active
network bridges. It does not close the postmaster.

The convenience form owns the postmaster it creates:

```ts
const server = await PGliteServer.create({
  postmaster: {
    dataDir: './pgdata',
    maxConnections: 20,
  },
  listen: { host: '127.0.0.1', port: 5432 },
})

await server.close({ mode: 'smart' })
```

This package owns Node listeners and PostgreSQL protocol byte transport only.
PostgreSQL processes, sessions, Wasm artifacts, and VFS implementations remain
owned by `@electric-sql/pglite`.
