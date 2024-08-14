---
outline: [2, 3]
---

# React

To aid integration of PGlite into a [React](https://react.dev/) project we have a `PGliteProvider` with a corresponding `usePGlite` and hooks for the [live query](./live-queries.md) plugin.

### PGliteProvider

The `PGliteProvider` enables you to initiate a PGlite database and pass it to all child components for use with the [`usePGlite`](#usepglite), [`useLiveQuery`](#uselivequery), and [`useLiveIncrementalQuery`](#useliveincrementalquery) hooks.

To use it, pass a PGlite instance as the `db` property.

```ts
import { PGlite } from "@electric-sql/pglite"
import { PGliteProvider } from "@electric-sql/pglite-react"

const db = new PGlite({
  extensions: { live }
})

const App = () => {
  // ...

  return (
    <PGliteProvider db=db>
      // ...
    </PGliteProvider>
  )
}
```

### usePGlite

You can retrieve the provided PGlite instance using `usePGlite` and then query it from within your components.

```ts
import { usePGlite } from "@electric-sql/pglite-react"

const MyComponent = () => {
  const db = usePGlite()

  const insertItem = () = {
    db.query("INSERT INTO my_table (name, number) VALUES ('Arthur', 42);")
  }

  return (
    <>
      <button click={insertItem}
    </>
  )
}
```

### makePGliteProvider

The `makePGliteProvider` function returns a `PGliteProvider` component and a `usePGlite` hook with the specified type, which enables you to provide a PGlite instance with all added extensions and retain then namespaces and types added to it.

```ts
import { PGlite } from "@electric-sql/pglite"
import { live } from "@electric-sql/pglite/live"
import { vector } from "@electric-sql/pglite/vector"
import { makePGliteProvider } from "@electric-sql/pglite-react"

const {
  PGliteProvider,
  usePGlite
} = makePGliteProvider<PGlite & {
  live: LiveNamespace;
  vector: VectorNamespace
}>()

export { PGliteProvider, usePGlite }
```

### useLiveQuery

The `useLiveQuery` hook enables you to reactively re-render your component whenever the results of a live query change. It wraps the [`.live.query()`](./live-queries.md#livequery) API.

It has the interface:

```ts
function useLiveQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
): Results<T>
```

And its arguments are:

1. the SQL query
2. optional parameters for the query

```ts
import { useLiveQuery } from "@electric-sql/pglite-react"

const MyComponent = () => {
  const maxNumber = 100
  const items = useLiveQuery(`
    SELECT *
    FROM my_table
    WHERE number <= $1
    ORDER BY number;
  `, [maxNumber])

  return (
    <>
      {
        items.map((item) =>
          <MyItem item={item} />
        )
      }
    </>
  )
}
```

### useLiveIncrementalQuery

The `useLiveIncrementalQuery` hook enables you to reactively re-render your component whenever the results of a live query change. It wraps the [`.live.incrementalQuery()`](./live-queries.md#liveincrementalquery) API, which provides a way to efficiently diff the query results in Postgres.

It has the interface:

```ts
function useLiveQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key: string,
): Results<T>
```

And its arguments are:

1. the SQL query
2. optional parameters for the query
3. the name of the column to key the diff algorithm on

```ts
import { useLiveIncrementalQuery } from "@electric-sql/pglite-react"

const MyComponent = () => {
  const maxNumber = 100
  const items = useLiveIncrementalQuery(`
    SELECT *
    FROM my_table
    WHERE number <= $1
    ORDER BY number;
  `, [maxNumber], 'id')

  return (
    <>
      {
        items.map((item) =>
          <MyItem item={item} />
        )
      }
    </>
  )
}
```
