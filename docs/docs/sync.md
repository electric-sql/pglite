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
  shape: {
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'todo',
    },
  },
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
  The shape stream specification to sync, described by the Electric [ShapeStream API](https://electric-sql.com/docs/api/clients/typescript#shapestream) options, see the [ShapeStream API](https://electric-sql.com/docs/api/clients/typescript#options) for more details.

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

- `unsubscribe()`<br>
  Unsubscribe from the shape. Note that this does not clear the state that has been synced into the table.

- `stream: ShapeStream`<br>
  The underlying `ShapeStream` instance, see the [ShapeStream API](https://electric-sql.com/docs/api/clients/typescript#shapestream) for more details.

## Limitations

- It is currently not possible to sync multiple shapes into the same table, as shape subscriptions require being able to drop all data and start over. We are working on a fix for this case, but the current version will throw if a shape is synced into the same table more than once.

- In order to maintain transactional consistency, data is aggregated in-memory until we can guarantee its consistency, which might create a lot of memory usage for very large shapes. We are working on resolving this issue, and it is only a problem for initial syncing.

## Sync using legacy Electric

Prior to the development of the new sync engine, the previous version of PGlite and Electric also had a sync capability. You can [read more about it on our blog](https://electric-sql.com/blog/2024/05/14/electricsql-postgres-client-support).
