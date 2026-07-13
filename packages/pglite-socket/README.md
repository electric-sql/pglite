# `@electric-sql/pglite-socket`

A byte-transparent TCP and Unix-socket frontend for multi-session PGlite on
Node.js 22 and newer.

This release replaces the old single-user query multiplexer. Each accepted OS
socket is connected to one virtual postmaster connection and, after PostgreSQL
startup, one real backend Worker. PostgreSQL owns protocol framing,
authentication, session and transaction state, connection admission,
`BackendKeyData`, and `CancelRequest` handling.

## Embedding

```ts
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { PGliteSocketServer } from '@electric-sql/pglite-socket'

const postmaster = await PGlitePostmaster.create({
  dataDir: 'file://./pgdata',
  maxConnections: 20,
})

const server = new PGliteSocketServer({
  postmaster,
  listen: { host: '127.0.0.1', port: 5432 },
})

await server.start()

process.once('SIGINT', async () => {
  await server.stop()
  await postmaster.close()
})
```

`PGliteSocketServer` does not own the supplied postmaster. Calling `stop()`
closes the frontend and its virtual connections but does not close the
database.

Listening modes are:

```ts
{ host: '127.0.0.1', port: 5432 } // TCP; port 0 selects a free port
{ path: '/tmp/my-pglite.sock' }    // exact Unix-socket path
{ directory: '/tmp', port: 5432 }  // /tmp/.s.PGSQL.5432 plus .lock metadata
```

`start()` returns the effective address. `address`, `connectionCount`,
`isListening`, and `getServerConn()` expose the current frontend state.

The bridge does not parse frontend messages. Its two independent pumps apply
backpressure directly between Node streams and the postmaster's bounded SAB
rings, so protocol fragmentation, COPY streaming, notices, and cancellation
connections follow PostgreSQL's own behavior.

## CLI

```sh
pglite-server --db=file://./pgdata --port=5432
pglite-server --db=file://./pgdata --socket-directory=/tmp --port=5432
pglite-server --db=file://./pgdata --port=0 \
  --run='node app.js' --include-database-url
```

The CLI prints one JSON `pglite-ready` record after both PostgreSQL and the OS
listener are ready. A command started with `--run` receives `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and `PGSSLMODE`; `--include-database-url` also exports
`DATABASE_URL`.

Use `pglite-server --help` for artifact, PostgreSQL configuration, and listener
options. TLS termination is not implemented in the frontend; native clients
should use `sslmode=disable`. PostgreSQL itself rejects `SSLRequest` in this
profile and continues startup on the same connection.
