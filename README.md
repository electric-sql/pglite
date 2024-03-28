<p align="center">
  <a href="https://electric-sql.com" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
      <img alt="ElectricSQL logo"
          src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  PGlite - the WASM build of Postgres from <a href="https://electric-sql.com" target="_blank">ElectricSQL</a>.<br>
  Build reactive, realtime, local-first apps directly on Postgres.
<p>

<p align="center">
  <a href="https://github.com/electric-sql/pglite/stargazers/"><img src="https://img.shields.io/github/stars/electric-sql/pglite?style=social&label=Star" /></a>
  <!-- <a href="https://github.com/electric-sql/pglite/actions"><img src="https://github.com/electric-sql/pglite/workflows/CI/badge.svg" alt="CI"></a> -->
  <a href="https://github.com/electric-sql/pglite/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="#roadmap"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://twitter.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow @ElectricSQL"></a>
  <a href="https://fosstodon.org/@electric" target="_blank"><img src="https://img.shields.io/mastodon/follow/109599644322136925.svg?domain=https%3A%2F%2Ffosstodon.org"></a>
</p>

# PGlite - Postgres in WASM

![PGlite](https://raw.githubusercontent.com/electric-sql/pglite/main/screenshot.png)

PGlite is a WASM Postgres build packaged into a TypeScript client library that enables you to run Postgres in the browser, Node.js and Bun, with no need to install any other dependencies. It is only 2.6mb gzipped.

```javascript
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun) or indexedDB (Browser).

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM.

It is being developed at [ElectricSQL](http://electric-sql.com) in collaboration with [Neon](http://neon.tech). We will continue to build on this experiment with the aim of creating a fully capable lightweight WASM Postgres with support for extensions such as pgvector.

## Whats new in V0.1

Version 0.1 (up from 0.0.2) includes significant changes to the Postgres build - it's about 1/3 smaller at 2.6mb gzipped, and up to 2-3 times faster. We have also found a way to statically compile Postgres extensions into the build - the first of these is pl/pgsql with more coming soon.

Key changes in this release are:

- Support for [parameterised queries](#querytquery-string-params-any-options-queryoptions-promiseresultst) #39
- An interactive [transaction API](#transactiontcallback-tx-transaction--promiset) #39
- pl/pgsql support #48
- Additional [query options](#queryoptions) #51
- Run PGlite in a [Web Workers](#web-workers) #49
- Fix for running on Windows #54
- Fix for missing `pg_catalog` and `information_schema` tables and view #41

We have also [published some benchmarks](https://github.com/electric-sql/pglite/blob/main/packages/benchmark/README.md) in comparison to a WASM SQLite build, and both native Postgres and SQLite. While PGlite is currently a little slower than WASM SQLite we have plans for further optimisations, including OPFS support and removing some the the Emscripten options that can add overhead.

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

## Node/Bun

Install into your project:

```bash
npm install @electric-sql/pglite
```

To use the in-memory Postgres:

```javascript
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

or to persist to the filesystem:

```javascript
const db = new PGlite("./path/to/pgdata");
```

## Deno

To use the in-memory Postgres, create a file `server.ts`:

```typescript
import { PGlite } from "npm:@electric-sql/pglite";

Deno.serve(async (_request: Request) => {
  const db = new PGlite();
  const query = await db.query("select 'Hello world' as message;");

  return new Response(JSON.stringify(query));
});
```

Then run the file with `deno run --allow-net --allow-read server.ts`.

## API Reference  

### Main Constructor:

#### `new PGlite(dataDir: string, options: PGliteOptions)`

A new pglite instance is created using the `new PGlite()` constructor.

##### `dataDir`

Path to the directory to store the Postgres database. You can provide a url scheme for various storage backends:

- `file://` or unprefixed: File system storage, available in Node and Bun.
- `idb://`: IndexedDB storage, available in the browser.
- `memory://`: In-memory ephemeral storage, available in all platforms.

##### `options`:

- `debug`: 1-5 - the Postgres debug level. Logs are sent to the console.

### Methods:

#### `.query<T>(query: string, params?: any[], options?: QueryOptions): Promise<Results<T>>`

Execute a single statement, optionally with parameters.

Uses the *extended query* Postgres wire protocol.

Returns single [result object](#results-objects).

##### Example:

```ts
await pg.query(
  'INSERT INTO test (name) VALUES ($1);',
  [ 'test' ]
);
// { affectedRows: 1 },
```

##### QueryOptions:

The `query` and `exec` methods take an optional `options` objects with the following parameters:

- `rowMode: "object" | "array"`
  The returned row object type, either an object of `fieldName: value` mappings or an array of positional values. Defaults to `"object"`.
- `parsers: ParserOptions`
  An object of type  `{[[pgType: number]: (value: string) => any;]}` mapping Postgres data type id to parser function.
  For convenance the `pglite` package exports a const for most common Postgres types:

  ```ts
  import { types } from "@electric-sql/pglite";
  await pg.query(`
    SELECT * FROM test WHERE name = $1;
  `, ["test"], {
    rowMode: "array",
    parsers: {
      [types.TEXT]: (value) => value.toUpperCase(),
    }
  });
  ```

#### `.exec(query: string, options?: QueryOptions): Promise<Array<Results>>`

Execute one or more statements. *(note that parameters are not supported)*

This is useful for applying database migrations, or running multi-statement sql that doesn't use parameters.

Uses the *simple query* Postgres wire protocol.

Returns array of [result objects](#results-objects), one for each statement.

##### Example:

```ts
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
  INSERT INTO test (name) VALUES ('test');
  SELECT * FROM test;
`);
// [
//   { affectedRows: 0 },
//   { affectedRows: 1 },
//   {
//     rows: [
//       { id: 1, name: 'test' }
//     ]
//     affectedRows: 0,
//     fields: [
//       { name: 'id', dataTypeID: '23' },
//       { name: 'name', dataTypeID: '25' },
//     ]
//   }
// ]
```

#### `.transaction<T>(callback: (tx: Transaction) => Promise<T>)`

To start an interactive transaction pass a callback to the transaction method. It is passed a `Transaction` object which can be used to perform operations within the transaction.

##### `Transaction` objects:

- `tx.query<T>(query: string, params?: any[], options?: QueryOptions): Promise<Results<T>>`
  The same as the main [`.query` method](#querytquery-string-params-any-promiseresultst).
- `tx.exec(query: string, options?: QueryOptions): Promise<Array<Results>>`
  The same as the main [`.exec` method](#execquery-string-promisearrayresults).
- `tx.rollback()`
  Rollback and close the current transaction.

##### Example:

```ts
await pg.transaction(async (tx) => {
  await tx.query(
    'INSERT INTO test (name) VALUES ('$1');',
    [ 'test' ]
  );
  return await ts.query('SELECT * FROM test;');
});
```

#### `.close(): Promise<void>`

Close the database, ensuring it is shut down cleanly.

### Properties:

- `.ready` *boolean (read only)*: Whether the database is ready to accept queries.
- `.closed` *boolean (read only)*: Whether the database is closed and no longer accepting queries.
- `.waitReady` *Promise<void>*: Promise that resolves when the database is ready to use. Note that queries will wait for this if called before the database has fully initialised, and so it's not necessary to wait for it explicitly.

### Results<T> Objects:

Result objects have the following properties:

- `rows: Row<T>[]` - The rows retuned by the query
- `affectedRows?: number` - Count of the rows affected by the query. Note this is *not* the count of rows returned, it is the number or rows in the database changed by the query.
-  `fields: { name: string; dataTypeID: number }[]` - Field name and Postgres data type ID for each field returned.


### Row<T> Objects:

Rows objects are a key / value mapping for each row returned by the query.

The `.query<T>()` method can take a TypeScript type describing the expected shape of the returned rows. *(Note: this is not validated at run time, the result only cast to the provided type)*

### Web Workers:

It's likely that you will want to run PGlite in a Web Worker so that it doesn't block the main thread. To aid in this we provide a `PGliteWorker` with the same API as the core `PGlite` but it runs Postgres in a dedicated Web Worker. To use, import from the `/worker` export:

```js
import { PGliteWorker } from "@electric-sql/pglite/worker";

const pg = new PGliteWorker('idb://my-database');
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);
```

*Work in progress: We plan to expand this API to allow sharing of the worker PGlite across browser tabs.*

## Extensions

PGlite supports the pl/pgsql procedural language extension, this is included and enabled by default.

In future we plan to support additional extensions, see the [roadmap](#roadmap).

## ORM support.

- Drizzle ORM supports PGlite, see [their docs here](https://orm.drizzle.team/docs/get-started-postgresql#pglite).

## How it works

PostgreSQL typically operates using a process forking model; whenever a client initiates a connection, a new process is forked to manage that connection. However, programs compiled with Emscripten - a C to WebAssembly (WASM) compiler - cannot fork new processes, and operates strictly in a single-process mode. As a result, PostgreSQL cannot be directly compiled to WASM for conventional operation.

Fortunately, PostgreSQL includes a "single user mode" primarily intended for command-line usage during bootstrapping and recovery procedures. Building upon this capability, PGlite introduces a input/output pathway that facilitates interaction with PostgreSQL when it is compiled to WASM within a JavaScript environment.

## Limitations

- PGlite is single user/connection.

## Roadmap

PGlite is *Alpha* and under active development, the current roadmap is:

- CI builds [#19](https://github.com/electric-sql/pglite/issues/19)
- Support Postgres extensions, starting with:
  - pgvector [#18](https://github.com/electric-sql/pglite/issues/18)
  - PostGIS [#11](https://github.com/electric-sql/pglite/issues/11)
- OPFS support in browser [#9](https://github.com/electric-sql/pglite/issues/9)
- Muti-tab support in browser [#32](https://github.com/electric-sql/pglite/issues/32)
- Syncing via [ElectricSQL](https://electric-sql.com) with a Postgres server [electric/#1058](https://github.com/electric-sql/electric/pull/1058) 

## Repository Structure

The PGlite project is split into two parts:

- `/packages/pglite`
  The TypeScript package for PGlite
- `/postgres` _(git submodule)_
  A fork of Postgres with changes to enable compiling to WASM:
  [/electric-sql/postgres-wasm](https://github.com/electric-sql/postgres-wasm)

Please use the [issues](https://github.com/electric-sql/pglite/issues/) in this main repository for filing issues related to either part of PGlite. Changes that affect both the TypeScript package and the Postgres source should be filed as two pull requests - one for each repository, and they should reference each other.

## Building

There are a couple of prerequisites:

- the Postgres build toolchain - https://www.postgresql.org/download/
- emscripten version 3.1.56 - https://emscripten.org/docs/getting_started/downloads.html

To build, checkout the repo, then:

```
git submodule update --init
cd ./pglite/packages/pglite
emsdk install 3.1.56
emsdk activate 3.1.56
pnpm install
pnpm build
```

## Acknowledgments

PGlite builds on the work of [Stas Kelvich](https://github.com/kelvich) of [Neon](https://neon.tech) in this [Postgres fork](https://github.com/electric-sql/postgres-wasm).

## License

PGlite is dual-licensed under the terms of the [Apache License 2.0](https://github.com/electric-sql/pglite/blob/main/LICENSE) and the [PostgreSQL License](https://github.com/electric-sql/pglite/blob/main/POSTGRES-LICENSE), you can choose which you prefer.

Changes to the [Postgres source](https://github.com/electric-sql/postgres-wasm) are licensed under the PostgreSQL License.
