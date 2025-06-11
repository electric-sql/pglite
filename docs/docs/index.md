# Getting started with PGlite

PGlite can be used in both Node/Bun/Deno or the browser, and with any JavaScript framework.

## Install and start in Node/Bun/Deno

Install into your project:

::: code-group

```bash [npm]
npm install @electric-sql/pglite
```

```bash [pnpm]
pnpm install @electric-sql/pglite
```

```bash [yarn]
yarn add @electric-sql/pglite
```

```bash [bun]
bun install @electric-sql/pglite
```

```bash [deno]
deno add npm:@electric-sql/pglite
```

:::

To use the in-memory Postgres:

```js
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
```

or to persist to the native filesystem:

```js
const db = new PGlite('./path/to/pgdata')
```

## Install and start in the browser

It can be installed and imported using your usual package manager:

```js
import { PGlite } from '@electric-sql/pglite'
```

or using a CDN such as JSDeliver:

```js
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js'
```

Then for an in-memory Postgres:

```js
const db = new PGlite()
```

or to persist the database to IndexedDB:

```js
const db = new PGlite('idb://my-pgdata')
```

## Making a query

There are two methods for querying the database, `.query` and `.exec`. The former supports parameters, while the latter supports multiple statements.

First, let's create a table and insert some test data using the `.exec` method:

```js
await db.exec(`
  CREATE TABLE IF NOT EXISTS todo (
    id SERIAL PRIMARY KEY,
    task TEXT,
    done BOOLEAN DEFAULT false
  );
  INSERT INTO todo (task, done) VALUES ('Install PGlite from NPM', true);
  INSERT INTO todo (task, done) VALUES ('Load PGlite', true);
  INSERT INTO todo (task, done) VALUES ('Create a table', true);
  INSERT INTO todo (task, done) VALUES ('Insert some data', true);
  INSERT INTO todo (task) VALUES ('Update a task');
`)
```

The `.exec` method is perfect for migrations and batch inserts with raw SQL.

Now, let's retrieve an item using `.query` method:

```js
const ret = await db.query(`
  SELECT * from todo WHERE id = 1;
`)
console.log(ret.rows)
```

Output:

```js
;[
  {
    id: 1,
    task: 'Install PGlite from NPM',
    done: false,
  },
]
```

## Using parameterised queries

When working with user supplied values, it's always best to use parameterized queries; these are supported on the `.query` method.

We can use this to update a task:

```js
const ret = await db.query(
  'UPDATE todo SET task = $2, done = $3 WHERE id = $1',
  [5, 'Update a task using parameterized queries', true],
)
```

## What next?

- To learn more about [querying](./api.md#query) and [transactions](./api.md#transaction) along with the other methods and options available, you can read the main [PGlite API documentation](./api.md).

- There is also a [live-query extension](./live-queries.md) that enables reactive queries to update a UI when the underlying database changes.

- PGlite has a number of built-in [virtual file systems](./filesystems.md) to provide persistance for your database.

- There are [framework hooks](./framework-hooks/react.md) to make working with PGlite within React and Vue much easier with less boilerplate.

- For help configuring PGlite with your bundler, see the [bundler support](./bundler-support.md) page.

- As PGlite only has a single exclusive connection to the database, we provide a [multi-tab worker](./multi-tab-worker.md) to enable sharing a PGlite instance between multiple browser tabs.

- There is a [REPL component](./repl.md) that can be easily embedded into a web-app to aid in debugging and development, or as part of a database application itself.

- We maintain a [list of ORMs and query builders](./orm-support.md) that support PGlite.

- PGlite supports both Postgres extensions and PGlite Plugins via its [extensions API](./api.md#options-extensions), and there is a list of [supported extensions](../extensions/).

- We have a [page of examples](../examples.md) that you can open to test out PGlite in the browser.
