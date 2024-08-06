# Multi-tab Worker

It's likely that you will want to run PGlite in a Web Worker so that it doesn't block the main thread. Additionally, as PGlite is single connection only, you may want to proxy multiple browser tabs to a single PGlite instance.

To aid in this, we provide a `PGliteWorker` with the same API as the standard PGlite, and a `worker` wrapper that exposes a PGlite instance to other tabs.

## Using PGliteWorker

First, you need to create a js file for your worker instance. You use the `worker` wrapper with an `init` option that returns a PGlite instance to start that database and expose it to all tabs:

```js
// my-pglite-worker.js
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

worker({
  async init() {
    // Create and return a PGlite instance
    return new PGlite();
  },
});
```

Then connect the `PGliteWorker` to your new worker process in your main script:

```js
import { PGliteWorker } from "@electric-sql/pglite/worker";

const pg = new PGliteWorker(
  new Worker(new URL("./my-pglite-worker.js", import.meta.url), {
    type: "module",
  })
);

// `pg` has the same interface as a standard PGlite interface
```

Internally, this starts a worker for each tab, but then runs an a election to nominate one as the leader. Only the leader then starts PGlite by calling the `init` function, and handles all queries. When the leader tab is closed, a new election is run, and a new PGlite instance is started.

In addition to having all the standard methods of the [`PGlite` interface](./api.md), `PGliteWorker` also has the following methods and properties:

- `onLeaderChange(callback: () => void)`<br>
  This allows you to subscribe to a notification when the leader worker is changed. It returns an unsubscribe function.
- `offLeaderChange(callback: () => void)`<br>
  This allows you to unsubscribe from the leader change notification.
- `isLeader: bool`
  A boolean property indicating if this instance is the leader.

## Passing options to a worker

`PGliteWorker` takes an optional second parameter `options`; this can include any standard [PGlite options](./api.md#options) along with these additional options:

- `id: string`<br>
  This is an optional `id` to group your PGlite workers. The leader election is run between all `PGliteWorker`s with the same `id`.<br>
  If not provided, the url to the worker is concatenated with the `dataDir` option to create an id.
- `meta: any`<br>
  Any additional metadata you would like to pass to the worker process `init` function.

The `worker()` wrapper takes a single options argument, with a single `init` property. `init` is a function takes any options passed to `PGliteWorker`, excluding extensions, and returns a `PGlite` instance. You can use the options passed to decide how to configure your instance:

```js
// my-pglite-worker.js
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

worker({
  async init(options) {
    const meta = options.meta
    // Do something with additional metadata.
    // or even run your own code in the leader along side the PGlite
    return new PGlite({
      dataDir: options.dataDir
    });
  },
});

// my-app.js
import { PGliteWorker } from "@electric-sql/pglite/worker";

const pg = new PGliteWorker(
  new Worker(new URL("./my-pglite-worker.js", import.meta.url), {
    type: "module",
  }),
  {
    dataDir: 'idb://my-db',
    meta: {
      // additional metadata passed to `init`
    }
  }
);
```

## Extension support

`PGliteWorker` has support for both Postgres extensions and PGlite plugins using the normal [extension api](./api.md#optionsextensions).

Any extension can be used by the PGlite instance inside the worker, however the extensions namespace is not exposed on a connecting `PGliteWorker` on the main thread.

```js
// my-pglite-worker.js
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";
import { vector } from "@electric-sql/pglite/vector";

worker({
  async init() {
    return new PGlite({
      extensions: {
        vector
      }
    });
  },
});
```

Extensions that only use the PGlite plugin interface, such as live queries, can be used on the main thread with `PGliteWorker` to expose their functionality; this is done by providing a standard options object as a second argument to the `PGliteWorker` constructor:

```js
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { live } from "@electric-sql/pglite/live";

const pg = new PGliteWorker(
  new Worker(new URL("./my-pglite-worker.js", import.meta.url), {
    type: "module",
  }),
  {
    extensions: {
      live
    }
  }
);
```

`PGliteWorker` also has a `create` static method that resolves to a new instance when it is fully initiated. This also adds the correct types for any extensions to the `PGliteWorker` instance:

```ts
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { live } from "@electric-sql/pglite/live";

const pg = await PGliteWorker.create(
  new Worker(new URL("./my-pglite-worker.js", import.meta.url), {
    type: "module",
  }),
  {
    extensions: {
      live
    }
  }
);

// TypeScript is aware of the `pg.live` namespace:
pg.live.query(/* ... */)
```
