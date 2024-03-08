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
  <a href="https://github.com/electric-sql/pglite/stargazers/"><img src="https://img.shields.io/github/stars/electric-sql/pglite?style=social&label=Star&maxAge=2592000" /></a>
  <!-- <a href="https://github.com/electric-sql/pglite/actions"><img src="https://github.com/electric-sql/pglite/workflows/CI/badge.svg" alt="CI"></a> -->
  <a href="https://github.com/electric-sql/pglite/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="#roadmap"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://twitter.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow @ElectricSQL"></a>
  <a href="https://fosstodon.org/@electric" target="_blank"><img src="https://img.shields.io/mastodon/follow/109599644322136925.svg?domain=https%3A%2F%2Ffosstodon.org"></a>
</p>

# PGlite - Postgres in WASM

![PGlite](https://raw.githubusercontent.com/electric-sql/pglite/main/screenshot.png)

PGlite is a WASM Postgres build packaged into a TypeScript client library that enables you to run Postgres in the browser, Node.js and Bun, with no need to install any other dependencies. It is only 3.7mb gzipped.

```javascript
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> [ { message: "Hello world" } ]
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun) or indexedDB (Browser).

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM.

It is being developed at [ElectricSQL](http://electric-sql.com) in collaboration with [Neon](http://neon.tech). We will continue to build on this experiment with the aim of creating a fully capable lightweight WASM Postgres with support for extensions such as pgvector.

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
// -> [ { message: "Hello world" } ]
```

or to persist to the filesystem:

```javascript
const db = new PGlite("./path/to/pgdata");
```

## Browser

It can be loaded via JSDeliver or your usual package manager, and for an in-memory Postgres:

```xml
<script type="module">
import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js";

const db = new PGlite()
await db.query("select 'Hello world' as message;")
// -> [ { message: "Hello world" } ]
</script>
```

or to persist the database to indexedDB:

```javascript
const db = new PGlite("idb://my-pgdata");
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

## How it works

PostgreSQL typically operates using a process forking model; whenever a client initiates a connection, a new process is forked to manage that connection. However, programs compiled with Emscripten - a C to WebAssembly (WASM) compiler - cannot fork new processes, and operates strictly in a single-process mode. As a result, PostgreSQL cannot be directly compiled to WASM for conventional operation.

Fortunately, PostgreSQL includes a "single user mode" primarily intended for command-line usage during bootstrapping and recovery procedures. Building upon this capability, PGlite introduces a input/output pathway that facilitates interaction with PostgreSQL when it is compiled to WASM within a JavaScript environment.

## Limitations

- PGlite is single user/connection.
- Parameterized queries are not currently supported, but this will be added soon.

## Roadmap

PGlite is *Alpha* and under active development, the current roadmap is:

- Support parameterized queries [#17](https://github.com/electric-sql/pglite/issues/17)
- CI builds [#19](https://github.com/electric-sql/pglite/issues/19)
- Benchmarking [#24](https://github.com/electric-sql/pglite/issues/24)
- Support Postgres extensions, starting with:
  - pgvector [#18](https://github.com/electric-sql/pglite/issues/18)
  - PostGIS [#11](https://github.com/electric-sql/pglite/issues/11)
- Use the Postgres wire protocol for input/output [#31](https://github.com/electric-sql/pglite/issues/31)

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
- emscripten version 3.1.25 - https://emscripten.org/docs/getting_started/downloads.html

To build, checkout the repo, then:

```
git submodule update --init
cd ./pglite/packages/pglite
emsdk install 3.1.25
emsdk activate 3.1.25
pnpm install
pnpm build
```

## Acknowledgments

PGlite builds on the work of [Stas Kelvich](https://github.com/kelvich) of [Neon](https://neon.tech) in this [Postgres fork](https://github.com/electric-sql/postgres-wasm).

## License

PGlite is dual-licensed under the terms of the [Apache License 2.0](https://github.com/electric-sql/pglite/blob/main/LICENSE) and the [PostgreSQL License](https://github.com/electric-sql/pglite/blob/main/POSTGRES-LICENSE), you can choose which you prefer.

Changes to the [Postgres source](https://github.com/electric-sql/postgres-wasm) are licensed under the PostgreSQL License.
