# Sync using ElectricSQL

At [ElectricSQL](https://electric-sql.com/) we are building a sync engine to enable realtime partial replication from Postgres to any other datastore, be it a JavaScript framework state store in a webapp, a database at the edge, or an embedded database in the mobile application.

We recently started on a [new version of the Electric sync engine](https://next.electric-sql.com) that is more loosely coupled, and will have improved scalability. You can read more about the work we are doing here: [next.electric-sql.com](https://next.electric-sql.com)

To accompany the new sync engine, we are developing a sync extension for PGlite that will enable you to synchronise a remote Postgres with PGlite. As the new Electric sync engine continues to be developed, additional functionality will be added to the sync plugin.

The first _alpha_ version of the sync plugin can sync a "shape" from Electric into a table in your PGlite. We don't yet support local writes being synced out, or conflict resolution, but we are actively exploring the best way to enable this in a layered and extendable way.

## Using the Sync plugin _(alpha)_

To use the sync plugin, first install the `@electric-sql/pglite-sync` package:

```sh
npm install @electric-sql/pglite-sync
```

Then add it to you PGlite instance and create any local tables needed:

```ts
import { electricSync } from '@electric-sql/pglite-sync'

const pg = await PGlite.create({
  extensions: {
    electric: electricSync(),
  },
})

await pg.exec(`
  CREATE TABLE IF NOT EXISTS todo (
    id SERIAL PRIMARY KEY,
    task TEXT,
    done BOOLEAN
  );
`)
```

You can then use the `syncShapeToTable` method to sync a table from Electric:

```ts
const shape = await pg.electric.syncShapeToTable({
  url: 'http://localhost:3000/v1/shape/todo',
  table: 'todo',
  primaryKey: ['id'],
})
```

To stop syncing you can call `unsubscribe` on the shape:

```ts
shape.unsubscribe()
```

There is a full example you can run locally in the [GitHub repository](https://github.com/electric-sql/pglite/tree/main/packages/pglite-sync/example).

## syncShapeToTable API

The `syncShapeToTable` is a relatively thin wrapper around the Electric [ShapeStream API](https://next.electric-sql.com/api/clients/typescript#shapestream) designed to do the minimal required to sync a shape _into_ a table.

It takes the following options as an object:

- `table: string`<br>
  The name of the table to sync into.

- `schema: string`<br>
  The name of the Postgres schema that the table to sync into is part of, defaults to `"public"`.

- `mapColumns: MapColumns`<br>
  An object indicating the mapping of the shape column values to your local table. This can be either a simple object of `localColumnName: shapeColumnName` mapping, or a function that takes a replication message and returns a mapping of `localColumnName: newValue`.

- `primaryKey: string[]`<br>
  An array of column names that form the primary key of the table you are syncing into. Used for updates and deletes.

- `url: string`<br>
  The full URL to where the Shape is hosted. This can either be the Electric server directly, or a proxy. E.g. for a local Electric instance, you might set `http://localhost:3000/v1/shape/foo`

- `where?: string`<br>
  Where clauses for the shape.

- `offset?: Offset`<br>
  The "offset" on the shape log. This is typically not set as the ShapeStream will handle this automatically. A common scenario where you might pass an offset is if you're maintaining a local cache of the log. If you've gone offline and are re-starting a ShapeStream to catch-up to the latest state of the Shape, you'd pass in the last offset and shapeId you'd seen from the Electric server so it knows at what point in the shape to catch you up from.

- `shapeId?: string`<br>
  The server side `shapeId`, similar to `offset`, this isn't typically used unless you're maintaining a cache of the shape log.

- `backoffOptions`<br>
  Options to configure the backoff rules on failure

- `subscribe?: boolean`<br>
  Automatically fetch updates to the Shape. If you just want to sync the current shape and stop, pass false.

- `signal?: AbortSignal`<br>
  A `AbortSignal` instance to use to abort the sync.

The returned `shape` object from the `syncShapeToTable` call has the following methods:

- `isUpToDate: boolean`<br>
  Indicates that the stream had caught up to the main Postgres.

- `shapeId: string`<br>
  The server side `shapeId`

- `subscribeOnceToUpToDate(cb: () => void, error: (err: FetchError | Error) => void)`<br>
  A callback to indicate that the shape caught up to the main Postgres.

- `unsubscribeAllUpToDateSubscribers()`<br>
  Unsubscribe all `subscribeOnceToUpToDate` listeners.

- `subscribeMustRefresh(cb: () => void)`<br>
  A callback that is called when the stream emits a `must-refresh` message.

- `unsubscribeMustRefresh(cb: () => void)`<br>
  Unsubscribe from the `mustRefresh` notification.

- `lastOffset: string`<br>
  The last offset that was committed to the database

- `unsubscribe()`<br>
  Unsubscribe from the shape. Note that this does not clear the state that has been synced into the table.

## Sync using legacy Electric

Prior to the development of the new sync engine, the previous version of PGlite and Electric also had a sync capability. You can [read more about it on our blog](https://electric-sql.com/blog/2024/05/14/electricsql-postgres-client-support).
