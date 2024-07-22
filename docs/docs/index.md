# Getting started with PGlite

PGlite is a WASM Postgres build packaged into a TypeScript client library that enables you to run Postgres in the browser, Node.js and Bun, with no need to install any other dependencies. It is only 2.6mb gzipped.

```js
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun) or indexedDB (Browser).

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM.

## Node/Bun

Install into your project:

```bash
npm install @electric-sql/pglite
```

To use the in-memory Postgres:

```js

import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

or to persist to the filesystem:

```js

const db = new PGlite("./path/to/pgdata");
```

## Browser

It can be installed and imported using your usual package manager:

```js
import { PGlite } from "@electric-sql/pglite";
```
or using a CDN such as JSDeliver:

```js
import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js";
```

Then for an in-memory Postgres:

```js
const db = new PGlite()
await db.query("select 'Hello world' as message;")
// -> { rows: [ { message: "Hello world" } ] }
```

or to persist the database to indexedDB:

```js
const db = new PGlite("idb://my-pgdata");
```