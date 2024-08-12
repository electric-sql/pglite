# What is PGlite

PGlite is a [WASM](https://webassembly.org/) Postgres build packaged into a TypeScript/JavaScript client library, that enables you to run Postgres in the browser, [Node.js](https://nodejs.org/) and [Bun](https://bun.sh/), with no need to install any other dependencies. It's under 3mb Gzipped, and has support for many [Postgres extensions](../extensions/), including [pgvector](../extensions/#pgvector).

Getting started with PGlite is simple: just install and import the NPM package, then create your embedded database:

```js
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.query("select 'Hello world' as message;")
// -> { rows: [ { message: "Hello world" } ] }
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun), or IndexedDB (browser).

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM.

It's being developed by [ElectricSQL](https://next.electric-sql.com/) for our use case of embedding into applications, either locally or at the edge, allowing users to sync a subset of their server-side Postgres database.

However, there are many more use cases for PGlite beyond its use as an embedded application database:

- **Unit and CI testing**<br>
  PGlite is very fast to start and tear down. It's perfect for unit tests - you can have a unique fresh Postgres for each test.

- **Local development**<br>
  You can use PGlite as an alternative to a full local Postgres for development; simplifying your development environments.

- **Remote development, or local web containers**<br>
  As PGlite is so lightweight it can be easily embedded into remote containerised development environments, or in-browser [web containers](https://webcontainers.io).

- **On-device or edge AI and RAG**<br>
  PGlite has full support for [pgvector](../extensions/#pgvector), enabling a local or edge retrieval augmented generation (RAG) workflow.

We are very keen to establish PGlite both as an open source, and open contribution, project, working to build a community around it, so as to develop its capabilities for all use cases.

Read more in our [getting started guide](./index.md).
