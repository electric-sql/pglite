<p align="center">
  <a href="https://pglite.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/pglite/main/docs/public/img/brand/logo.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/pglite/main/docs/public/img/brand/logo-light.svg"
      />
      <img alt="ElectricSQL logo"
          src="https://raw.githubusercontent.com/electric-sql/pglite/main/docs/public/img/brand/logo-light.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://pglite.dev">PGlite</a> - the WASM build of Postgres from <a href="https://electric-sql.com" target="_blank">ElectricSQL</a>.<br>
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

PGlite is a WASM Postgres build packaged into a TypeScript client library that enables you to run Postgres in the browser, Node.js, Bun and Deno, with no need to install any other dependencies. It is only 3mb gzipped and has support for many Postgres extensions, including [pgvector](https://github.com/pgvector/pgvector).

```javascript
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun/Deno) or indexedDB (Browser).

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM.

For full documentation and user guides see [pglite.dev](https://pglite.dev).

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

## Node/Bun/Deno

Install into your project:

**NodeJS**

```bash
npm install @electric-sql/pglite
```

**Bun**

```bash
bun install @electric-sql/pglite
```

**Deno**

```bash
deno add npm:@electric-sql/pglite
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

## How it works

PostgreSQL typically operates using a process forking model; whenever a client initiates a connection, a new process is forked to manage that connection. However, programs compiled with Emscripten - a C to WebAssembly (WASM) compiler - cannot fork new processes, and operates strictly in a single-process mode. As a result, PostgreSQL cannot be directly compiled to WASM for conventional operation.

Fortunately, PostgreSQL includes a "single user mode" primarily intended for command-line usage during bootstrapping and recovery procedures. Building upon this capability, PGlite introduces a input/output pathway that facilitates interaction with PostgreSQL when it is compiled to WASM within a JavaScript environment.

## Limitations

- PGlite is single user/connection.

## How to build PGlite and contribute

The build process of PGlite is split into two parts:

1. Building the Postgres WASM module.
2. Building the PGlite client library and other TypeScript packages.

Docker is required to build the WASM module, along with Node (v20 or above) and [pnpm](https://pnpm.io/) for package management and building the TypeScript packages.

To start checkout the repository and install dependencies:

```bash
git clone https://github.com/electric-sql/pglite
cd pglite
pnpm install
```

To build everything, we have the convenient `pnpm build:all` command in the root of the repository. This command will:

1. Use Docker to build the Postgres WASM module. The artifacts from this are then copied to `/packages/pglite/release`.
2. Build the PGlite client library and other TypeScript packages.

To _only_ build the Postgres WASM module (i.e. point 1 above), run

```bash
pnpm wasm:build
```

If you don't want to build the WASM module and assorted WASM binaries from scratch, you can download them from a comment under the most recently merged PR, labeled as _interim build files_, and place them under `packages/pglite/release`. 

To build all TypeScript packages (i.e. point 2 of the above), run:

```bash
pnpm ts:build
```

This will build all packages in the correct order based on their dependency relationships. You can now develop any individual package using the `build` and `test` scripts, as well as the `stylecheck` and `typecheck` scripts to ensure style and type validity.

Or alternatively to build a single package, move into the package directory and run:

```bash
cd packages/pglite
pnpm build
```

When ready to open a PR, run the following command at the root of the repository:
```bash
pnpm changeset
```
And follow the instructions to create an appropriate changeset. Please ensure any contributions that touch code are accompanied by a changeset.

## Acknowledgments

PGlite builds on the work of [Stas Kelvich](https://github.com/kelvich) of [Neon](https://neon.tech) in this [Postgres fork](https://github.com/electric-sql/postgres-wasm).

## License

PGlite is dual-licensed under the terms of the [Apache License 2.0](https://github.com/electric-sql/pglite/blob/main/LICENSE) and the [PostgreSQL License](https://github.com/electric-sql/pglite/blob/main/POSTGRES-LICENSE), you can choose which you prefer.

Changes to the [Postgres source](https://github.com/electric-sql/postgres-wasm) are licensed under the PostgreSQL License.
