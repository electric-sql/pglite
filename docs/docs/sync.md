# Sync using ElectricSQL

At [ElectricSQL](https://electric-sql.com/) we are building a sync engine to enable realtime partial replication from Postgres to any other datastore, be it a JavaScript framework state store in a webapp, a database at the edge, or an embedded database in the mobile application.

To accompany Electric, we are developing a sync extension for PGlite that will enable you to synchronise a remote Postgres with PGlite.

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
  shape: { url: 'http://localhost:3000/v1/shape?table=todo' },
  table: 'todo',
  primaryKey: ['id'],
})
```

To stop syncing you can call `unsubscribe` on the shape:

```ts
shape.unsubscribe()
```

There is a full example you can run locally in the [GitHub repository](https://github.com/electric-sql/pglite/tree/main/packages/pglite-sync/example).

## electricSync API

The `electricSync` plugin can be given some configuration options to allow customization of the sync process.

- `metadataSchema?: string`<br>
  The name of the Postgres schema that the shape metadata tables will be part of, defaults to `"electric"`.

- `debug?: boolean`<br>
  Enable debug logging, defaults to `false`.

## syncShapeToTable API

The `syncShapeToTable` is a relatively thin wrapper around the Electric [ShapeStream API](https://next.electric-sql.com/api/clients/typescript#shapestream) designed to do the minimal required to sync a shape _into_ a table.

It takes the following options as an object:

- `shape: ShapeStreamOptions`<br>
  The shape stream specification to sync, described by [`ShapeStreamOptions`](#shapestreamoptions).

- `table: string`<br>
  The name of the table to sync into.

- `schema: string`<br>
  The name of the Postgres schema that the table to sync into is part of, defaults to `"public"`.

- `mapColumns: MapColumns`<br>
  An object indicating the mapping of the shape column values to your local table. This can be either a simple object of `localColumnName: shapeColumnName` mapping, or a function that takes a replication message and returns a mapping of `localColumnName: newValue`.

- `primaryKey: string[]`<br>
  An array of column names that form the primary key of the table you are syncing into. Used for updates and deletes.

- `shapeKey: string`<br>
  Optional identifier for the shape subscription - if provided the stream state will be persisted along with the data in order to allow resuming the stream between sessions.

- `useCopy: boolean`<br>
  Whether to use the `COPY FROM` command to insert the initial data, defaults to `false`. This process may be faster than inserting row by row as it combines the inserts into a CSV to be passed to Postgres.

The returned `shape` object from the `syncShapeToTable` call has the following methods:

- `isUpToDate: boolean`<br>
  Indicates that the stream had caught up to the main Postgres.

- `shapeId: string`<br>
  The server side `shapeId`

- `subscribe(cb: () => void, error: (err: FetchError | Error) => void)`<br>
  A callback to indicate that the shape caught up to the main Postgres.

- `subscribeMustRefresh(cb: () => void)`<br>
  A callback that is called when the stream emits a `must-refresh` message.

- `unsubscribeMustRefresh(cb: () => void)`<br>
  Unsubscribe from the `mustRefresh` notification.

- `unsubscribe()`<br>
  Unsubscribe from the shape. Note that this does not clear the state that has been synced into the table.

### `ShapeStreamOptions`

- `url: string`<br>
  The full URL to where the Shape is hosted. This can either be the Electric server directly, or a proxy. E.g. for a local Electric instance, you might set `http://localhost:3000/v1/shape?table=table_name`

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

## Limitations

- It is currently not possible to sync multiple shapes into the same table, as shape subscriptions require being able to drop all data and start over. We are working on a fix for this case, but the current version will throw if a shape is synced into the same table more than once.

- In order to maintain transactional consistency, data is aggregated in-memory until we can guarantee its consistency, which might create a lot of memory usage for very large shapes. We are working on resolving this issue, and it is only a problem for initial syncing.

## Sync using legacy Electric

Prior to the development of the new sync engine, the previous version of PGlite and Electric also had a sync capability. You can [read more about it on our blog](https://electric-sql.com/blog/2024/05/14/electricsql-postgres-client-support).
