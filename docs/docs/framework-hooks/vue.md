---
outline: [2, 3]
---

# Vue

To aid integration of PGlite into a [Vue](https://vuejs.org/) project we have a `providePGlite` with a corresponding `injectPGlite` and hooks for the [live query](../live-queries.md) plugin.

### providePGlite

The `providePGlite` API, which follows the [Vue provide / inject pattern](https://vuejs.org/guide/components/provide-inject), enables you to initiate a PGlite database and pass it to all child components for use with the corresponding [`injectPGlite`](#injectpglite) method, as well as with the [`useLiveQuery`](#uselivequery) and [`useLiveIncrementalQuery`](#useliveincrementalquery) hooks.

To use it, pass a PGlite instance as the `db` property.

```vue
<script lang="ts" setup>
import { PGlite } from '@electric-sql/pglite'
import { providePGlite } from '@electric-sql/pglite-vue'

const db = new PGlite()
providePGlite(db)
</script>
// ...
```

### injectPGlite

You can retrieve the provided PGlite instance using `injectPGlite` and then query it from within your components.

```vue
<script lang="ts" setup>
import { onMounted, shallowRef } from 'vue'
import { injectPGlite } from '@electric-sql/pglite-vue'

const db = injectPGlite()

const insertItem = () => {
  db.query("INSERT INTO my_table (name, number) VALUES ('Arthur', 42);")
}
</script>

<template>
  // ...
  <button @click="insertItem">Insert item</button>
  // ...
</template>
```

### makePGliteDependencyInjector

The `makePGliteDependencyInjector` function returns typed versions of `providePGlite` and `injectPGlite`, which enables you to provide a PGlite instance with all added extensions and retain then namespaces and types added to it.

```ts
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite/vector'
import { makePGliteDependencyInjector } from '@electric-sql/pglite-vue'

const { providePGlite, injectPGlite } = makePGliteDependencyInjector<
  PGlite &
    PGliteInterfaceExtensions<{
      live: typeof live
      vector: typeof vector
    }>
>()

export { providePGlite, injectPGlite }
```

### useLiveQuery

The `useLiveQuery` hook enables you to reactively receive updates to the results of a live query change. It wraps the [`.live.query()`](../live-queries.md#livequery) API.

It has the interface:

```ts
function useLiveQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params?: QueryParams | WatchSource<QueryParams>,
): LiveQueryResults<T>
```

And its arguments, which can also be [watch sources](https://vuejs.org/guide/essentials/watchers.html#watch-source-types) that will trigger a re-run, are:

1. the SQL query
2. optional parameters for the query

```vue
<script lang="ts">
import { useLiveQuery } from '@electric-sql/pglite-vue'

const maxNumber = 100
const items = useLiveQuery(
  `
    SELECT *
    FROM my_table
    WHERE number <= $1
    ORDER BY number;
  `,
  [maxNumber],
)
</script>

<template>
  <MyItem v-for="item in items" :item="item" :key="item.id" />
</template>
```

### useLiveIncrementalQuery

The `useLiveIncrementalQuery` hook enables you to reactively receive updates whenever the results of a live query change. It wraps the [`.live.incrementalQuery()`](../live-queries.md#liveincrementalquery) API, which provides a way to efficiently diff the query results in Postgres.

It has the interface:

```ts
export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string | WatchSource<string>,
  params: QueryParams | WatchSource<QueryParams>,
  key: string | WatchSource<string>,
): LiveQueryResults<T>
```

And its arguments, which can also be [watch sources](https://vuejs.org/guide/essentials/watchers.html#watch-source-types) that will trigger a re-run, are:

1. the SQL query
2. optional parameters for the query
3. the name of the column to key the diff algorithm on

```vue
<script lang="ts">
import { useLiveInceremntalQuery } from '@electric-sql/pglite-vue'

const maxNumber = 100
const items = useLiveInceremntalQuery(
  `
    SELECT *
    FROM my_table
    WHERE number <= $1
    ORDER BY number;
  `,
  [maxNumber],
  'id',
)
</script>

<template>
  <MyItem v-for="item in items" :item="item" :key="item.id" />
</template>
```
