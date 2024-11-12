# Live Queries

The "live" extension enables you to subscribe to a query and receive updated results when the underlying tables change.

To use the extension, it needs to be added to the PGlite instance when creating it:

```ts
import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'

const pg = await PGlite.create({
  extensions: {
    live,
  },
})
```

There are three methods on the `live` namespace:

- `live.query()` for basic live queries. With less machinery in PGlite, it's quicker for small results sets and narrow rows.
- `live.incrementalQuery()` for incremental queries. It materialises the full result set on each update from only the changes emitted by the `live.changes` API. Perfect for feeding into React, and with good performance for large result sets and wide rows.
- `live.changes()` a lower level API that emits the changes (insert/update/delete) that can then be mapped to mutations in a UI or other datastore.

## live.query

`live.query<T>()`

This is very similar to a standard query, but takes an additional callback that receives the results whenever they change:

```js
const ret = pg.live.query('SELECT * FROM test ORDER BY rand;', [], (res) => {
  // res is the same as a standard query result object
})
```

You can also pass an options object with `offset` and `limit` to implement efficient windowed queries:

```js
const ret = pg.live.query({
  query: 'SELECT * FROM test ORDER BY rand;',
  offset: 0,
  limit: 10,
  callback: (res) => {
    // res includes:
    // - rows: the rows for the current window
    // - offset: the current offset
    // - limit: the current limit
    // - totalCount: total number of rows in the full result set
  },
})
```

The windowed query is optimized to:

- Only transfer the rows within the requested window
- Efficiently update when rows enter/leave the window
- Track the total count separately to avoid slow COUNT(\*) queries blocking updates

You can update the window position by calling refresh with new offset/limit values:

```js
// Move to page 2
await ret.refresh(10, 10)
```

The returned value from the call is an object with this interface:

```ts
interface LiveQueryReturn<T> {
  initialResults: Results<T> & {
    offset?: number // Current offset (if windowed)
    limit?: number // Current limit (if windowed)
    totalCount?: number // Total row count (if windowed)
  }
  unsubscribe: () => Promise<void>
  refresh: (offset?: number, limit?: number) => Promise<void>
}
```

- `initialResults` is the initial results set (also sent to the callback)
- `unsubscribe` allows you to unsubscribe from the live query
- `refresh` allows you to force a refresh of the query with the updated results sent to the callback. For windowed queries you can optionally provide new offset/limit values.

Internally it watches the tables that the query depends on, and reruns the query whenever they are changed.

## live.incrementalQuery

`live.incrementalQuery<T>()`

Similar to above, but maintains a temporary table of the previous state inside of Postgres. When the tables it depends on change, the query is re-run and diffed with the last state. Only the changes from the last version of the query are copied from WASM into JS.

It requires an additional `key` argument - the name of a column (often a primary key) on which to key the diff.

```ts
const ret = pg.live.incrementalQuery(
  'SELECT * FROM test ORDER BY rand;',
  [],
  'id',
  (res) => {
    // res is the same as a standard query result object
  },
)
```

The returned value is of the same type as the `query` method above.

## live.changes

`live.changes()`

A lower-level API which is the backend for the `incrementalQuery`, it emits the changes that have occurred. It requires a `key` on which to compare row differences:

```ts
const ret = pg.live.changes(
  'SELECT * FROM test ORDER BY rand;',
  [],
  'id',
  (res) => {
    // res is a change result object
  },
)
```

The returned value from the call is defined by this interface:

```ts
interface LiveChangesReturn<T = { [key: string]: any }> {
  fields: { name: string; dataTypeID: number }[]
  initialChanges: Array<Change<T>>
  unsubscribe: () => Promise<void>
  refresh: () => Promise<void>
}
```

The results passed to the callback are an array of `Change` objects:

```ts
type ChangeInsert<T> = {
  __changed_columns__: string[]
  __op__: 'INSERT'
  __after__: number
} & T

type ChangeDelete<T> = {
  __changed_columns__: string[]
  __op__: 'DELETE'
  __after__: undefined
} & T

type ChangeUpdate<T> = {
  __changed_columns__: string[]
  __op__: 'UPDATE'
  __after__: number
} & T

type Change<T> = ChangeInsert<T> | ChangeDelete<T> | ChangeUpdate<T>
```

Each `Change` includes the new values along with:

- `__changed_columns__` the column names that were changed.
- `__op__` the operation that is required to update the state (`INSERT`, `UPDATE`, `DELETE`).
- `__after__` the `key` of the row after which _this_ row should be positioned; it will be included in `__changed_columns__` if it has been changed. This allows for very efficient moves within an ordered set of results.

This API can be used to implement very efficient in-place DOM updates.
