# PGlite Node Distribution and PostgreSQL-Compatible CLI

Status: implementation complete; npm name reservation pending<br>
Initial target: Node.js 22 or newer<br>
Repository package: `packages/pglite-cli`<br>
Published package and executable: `pglite`<br>
Last updated: 2026-07-15

## 1. Summary

PGlite will provide an unscoped `pglite` npm package as its batteries-included
Node.js distribution. The package will expose a `pglite` executable, re-export
the principal programmatic APIs, and depend on separately maintained core,
Node network-server, and PostgreSQL tool packages.

The intended user experience is:

```sh
npx pglite initdb -D ./pgdata
npx pglite postgres -D ./pgdata -p 5432
npx pglite psql -h localhost -p 5432 postgres
npx pglite pg_dump -h localhost mydb > dump.sql
```

And, after installation:

```ts
import { PGlite } from 'pglite'
import { PGlitePostmaster } from 'pglite/postmaster'
import { PGliteServer } from 'pglite/server'
```

The unscoped package is a distribution and assembly layer, not a new location
for database implementation code. Its CLI dispatches to supported APIs in the
scoped packages. It must not accumulate a second postmaster, socket frontend,
filesystem abstraction, or PostgreSQL tool runtime.

The cross-runtime multi-session database API remains part of
`@electric-sql/pglite`. `PGlitePostmaster.create()` and the sessions it returns
are available through the core package in Node and, in a later phase, supported
browsers. Browser implementation is explicitly outside the scope of this Node
distribution plan, but the package and source boundaries established here must
not make it a Node-only API. `@electric-sql/pglite-server` is only the Node
network host that exposes a core postmaster through TCP or Unix-domain sockets.

The proposed package boundaries are:

| Repository directory     | Published package             | Responsibility                                                |
| ------------------------ | ----------------------------- | ------------------------------------------------------------- |
| `packages/pglite`        | `@electric-sql/pglite`        | Classic and multi-session embedded APIs for browser and Node  |
| `packages/pglite-server` | `@electric-sql/pglite-server` | Node TCP and Unix-domain host for a core PGlite postmaster    |
| `packages/pglite-tools`  | `@electric-sql/pglite-tools`  | PostgreSQL client and administrative tools                    |
| `packages/pglite-cli`    | `pglite`                      | Batteries-included Node distribution and CLI                  |
| `packages/pglite-socket` | `@electric-sql/pglite-socket` | Compatibility line for the classic single-user socket wrapper |

At the time of writing, `pglite` is not registered in the public npm registry.
That observation is not a guarantee that the name will remain available. The
name should be reserved before implementation depends on it.

## 2. Decision

Create `packages/pglite-cli` and publish it as the unscoped `pglite` package.

The package will:

1. install the compatible core, server, and tools packages;
2. provide the `pglite` executable;
3. re-export the common embedded API from its root;
4. expose the postmaster, server, and tools through explicit subpath exports;
5. target Node.js only;
6. keep its implementation limited to distribution assembly, CLI parsing,
   process lifecycle, and presentation of errors.

The server package composes the public core postmaster API and consumes at most
one narrowly defined first-party network-host integration point. It must not
import Worker, memory, process-control, filesystem-broker, or Wasm internals.
The tools package may consume the separate internal initdb runtime contract.
Internal contracts are protected by exact package version matching.

The new multi-session socket frontend will move to
`@electric-sql/pglite-server`. The published `@electric-sql/pglite-socket`
package will retain its classic behavior rather than changing architecture
under the existing package identity.

The `pglite` CLI will resemble the PostgreSQL command suite, but it will not
claim that PostgreSQL has a native subcommand interface. PostgreSQL normally
ships `postgres`, `initdb`, `psql`, `pg_dump`, and other separate executables.
PGlite will present those programs as subcommands while preserving their
arguments, standard streams, and exit status as closely as practical.

## 3. Motivation

### 3.1 Separate the embedded library from the Node distribution

`@electric-sql/pglite` is currently the package used by browser and Node
applications embedding a database. The multi-session API is also an embedded
database API: Node uses Worker threads and a later browser implementation uses
SharedWorkers, Dedicated Workers, and a browser storage coordinator. It belongs
in core alongside the classic single-user API. TCP and Unix sockets, foreground
server lifecycle, and PostgreSQL utilities are Node distribution concerns.

Keeping Node network and command-suite components out of core will:

- avoid mixing `node:net` and CLI lifecycle code into browser-capable exports;
- keep PostgreSQL utility artifacts out of embedded applications;
- preserve a clear difference between an embedded postmaster and an externally
  reachable server;
- allow browser and Node postmasters to share one public API without depending
  on the unscoped distribution.

The unscoped distribution provides the complete experience without imposing
the network-server and tool dependencies on scoped core-package users. Core
does intentionally carry the opt-in multi-session runtime and artifacts; its
size and loading behavior are release gates described later in this document.

### 3.2 Separate the postmaster from its network host

The multi-session postmaster owns PostgreSQL processes, sessions, connection
admission, shared memories, signals, and database shutdown. Those capabilities
are useful without opening an operating-system socket and are also required by
the browser design, so they remain in `@electric-sql/pglite`.

`@electric-sql/pglite-server` owns a different concern: exposing a postmaster
through Node TCP and Unix-domain listeners. Describing that wrapper as a new
version of `pglite-socket` would still change the meaning of an existing
published package, so the new Node host receives its own identity.

### 3.3 Provide a direct PostgreSQL-like entry point

Users should be able to initialize and run PGlite without first writing a
JavaScript launcher. The unscoped name produces a concise command:

```sh
npx pglite postgres -D ./pgdata
```

This also provides a conventional target for examples, development tools,
framework integrations, test harnesses, and the upstream PostgreSQL regression
suites.

### 3.4 Preserve one implementation behind every interface

The CLI, programmatic server API, and socket protocol frontend must share the
same implementation. Starting a server through the CLI must exercise the same
postmaster and listener code as `PGliteServer.create()`.

## 4. Goals

1. Provide a batteries-included, Node-only `pglite` npm distribution.
2. Support `npx pglite <command>` without a global installation.
3. Re-export the normal embedded PGlite API for intuitive `import` usage.
4. Expose the cross-runtime multi-session postmaster through the core package
   and the Node network host through a stable server API.
5. Preserve the browser-oriented and classic runtime behavior of
   `@electric-sql/pglite`.
6. Keep Node network-server code and PostgreSQL tool artifacts out of the core
   package while loading multi-session core artifacts only from opt-in exports.
7. Preserve PostgreSQL command arguments, streams, diagnostics, and exit codes
   where the underlying Wasm programs support them.
8. Make unsupported PostgreSQL behavior explicit rather than approximating it
   silently.
9. Keep the existing PGlite VFS API available to programmatic server users.
10. Use exact, tested package combinations for the Wasm ABI and PostgreSQL
    version.
11. Make the CLI suitable for driving `make check` and `make check-world`
    through a real socket server.
12. Keep all Wasm build and transformation tooling inside the repository's
    Docker builder image.
13. Expose `initdb` as both a native-style CLI command and a supported
    TypeScript API.
14. Give every PostgreSQL-derived CLI command native defaults unless a
    difference is explicitly documented and tested.
15. Detect persistent-cluster incompatibility and conflicting classic/postmaster
    ownership before either runtime mutates a data directory.

## 5. Non-goals

The initial version will not:

- make the unscoped distribution a browser package;
- implement the browser multi-session runtime as part of this Node-focused
  reorganisation;
- replace `@electric-sql/pglite` as the canonical lightweight embedded API;
- implement database or server behavior inside `packages/pglite-cli`;
- emulate every executable shipped by a native PostgreSQL installation;
- claim byte-for-byte output compatibility for all PostgreSQL tools;
- publish executables named `postgres`, `psql`, or `initdb` into a user's npm
  bin directory;
- silently download missing tool packages when a command runs;
- daemonize in the first release;
- provide complete `pg_ctl` compatibility in the first release;
- hide unsupported PostgreSQL flags by accepting and ignoring them;
- require third-party VFS implementations to depend on the unscoped package;
- change the WebAssembly target based on whether an API was reached from the
  CLI or programmatically.

## 6. Package architecture

```text
                         pglite
                    Node distribution
                    CLI and re-exports
                      /       |       \
                     v        v        v
    @electric-sql/pglite  @electric-sql/  @electric-sql/
      classic +            pglite-server   pglite-tools
      postmaster API       Node sockets    PostgreSQL tools
                              |
                              v
                     @electric-sql/pglite
                        postmaster API
```

Dependencies must remain acyclic:

- `pglite` depends on the scoped core, server, and tools packages;
- `@electric-sql/pglite-server` declares an exact peer dependency on
  `@electric-sql/pglite` because it composes caller-owned postmasters and must
  share core class and type identity;
- `@electric-sql/pglite-tools` declares an exact peer dependency on
  `@electric-sql/pglite` when it consumes an internal runtime contract;
- `@electric-sql/pglite` must not depend on the server, tools, or unscoped
  distribution;
- no scoped implementation package may import from `pglite`.

The server package uses the public `openProtocolConnection()` API for explicit
PGlite-managed TCP and Unix listeners. Strict PostgreSQL-controlled listeners
also require one deliberately narrow first-party host entry point because the
current virtual socket host does not preserve the addresses passed to
PostgreSQL `bind()`, `listen()`, and close operations:

```text
@electric-sql/pglite/_internal/node-network-host
@electric-sql/pglite/_internal/initdb-runtime
```

These are not documented as application APIs and carry no independent semantic
versioning promise. The network-host contract contains only PostgreSQL socket
operations and listener lifecycle notifications. It must not expose process
Workers, Wasm memories, control registries, filesystem brokers, or artifact
loaders. The initdb contract remains separate. Consumers require the exact
compatible core version, and release tests validate the relevant runtime ABI
identity before use. The umbrella package installs the one core version
satisfying both peers, avoiding duplicate core class and type identities.

The network contract is fixed around an explicit attachment and decoded host
requests rather than Wasm details:

```ts
export interface PostgresHostBindRequest {
  readonly listenerId: number
  readonly generation: number
  readonly transport: 'tcp' | 'unix'
  readonly host?: string
  readonly port?: number
  readonly path?: string
  readonly unixMode?: number
  readonly unixGroup?: string
}

export interface PostgresNodeNetworkHost {
  bind(request: PostgresHostBindRequest): Promise<void>
  listen(listenerId: number, generation: number, backlog: number): Promise<void>
  close(listenerId: number, generation: number): Promise<void>
}

export function attachPostgresNodeNetworkHost(
  postmaster: PGlitePostmaster,
  host: PostgresNodeNetworkHost,
): Promise<AsyncDisposable>
```

Core decodes and validates PostgreSQL socket addresses before invoking this
contract. The server stores a bind request until `listen()`, creates the Node
listener at that point, and bridges accepted sockets through the public
`openProtocolConnection()` API. Listener identifiers are generation-fenced;
stale close operations cannot affect a replacement listener. Attachment is
exclusive per postmaster, and detachment closes every listener created by that
host before it resolves. For Unix sockets, core adds PostgreSQL's resolved
`unix_socket_permissions` and `unix_socket_group` values to the request before
the host materializes the listener; the Node host, rather than WasmFS, owns the
externally visible socket and lock paths. The exact internal spelling may
acquire additional result and error types during implementation, but it may not
expand into a general postmaster-runtime API.

### 6.1 `@electric-sql/pglite`

The core package remains the canonical embedded database library:

```ts
import { PGlite } from '@electric-sql/pglite'
```

It retains the current `PGlite` constructor, query interfaces, extensions,
filesystem abstractions, and classic single-user Wasm runtime.

It also owns the opt-in cross-runtime multi-session API:

```ts
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
```

The current branch's unpublished `./postmaster` subpath becomes the canonical
home for this API. Core owns:

- `PGlitePostmaster`, its session API, and connection admission;
- `BasePGlite` session behavior and stable `PGliteInterface` types;
- shared process-control, connection, signal, and Worker protocols;
- multi-memory views, tagged-pointer helpers, and runtime identity;
- the transformed multi-session Wasm artifact and process Worker assets;
- filesystem brokers, worker-aware factories, and VFS capability contracts;
- platform-specific Node and future browser postmaster runtimes.

The existing `PGlite` constructor and classic artifact remain unchanged. Merely
importing the package root must not load or bundle the postmaster runtime.

The Node implementation is the only multi-session implementation delivered by
this plan. Source and export boundaries nevertheless reserve a browser runtime
that can implement the same `PGlitePostmaster` API using a coordinator
SharedWorker, process SharedWorkers, Dedicated Workers, Web Locks, and OPFS.
Implementing or validating that browser topology belongs to its own plan and is
not an exit criterion for any phase in this document.

The core source should converge on this ownership layout:

```text
src/postmaster/
  index.ts                 shared public facade and exports
  types.ts                 platform-independent public types
  shared/                  process, memory, connection, and VFS protocols
  node/                    Worker-thread postmaster runtime
  browser/                 reserved future browser runtime boundary
```

Package export conditions or a platform facade must ensure that browser builds
never resolve `node:*` modules and Node builds do not eagerly include browser
coordinator or OPFS code. Until the browser runtime exists, browser and generic
default resolution of the postmaster subpath selects a small explicit
unsupported-platform stub, while the `node` condition selects the Node runtime.
That stub throws an actionable unsupported-platform error before touching
storage and is not browser support. Both eventual implementations use one
declaration surface.

### 6.2 `@electric-sql/pglite-server`

The server package owns:

- `PGliteServer`, which composes a postmaster with listeners;
- TCP and Unix-domain socket handling;
- PostgreSQL wire-protocol transport bridges;
- Node listener shutdown and owned socket-path cleanup;
- externally visible listener addresses and network-level observability;
- the Node implementation of the narrow PostgreSQL network-host adapter.

It does not own PostgreSQL processes, sessions, connection admission, shared
memories, process Workers, database shutdown, VFS implementations, or Wasm
artifacts. Those remain in core.

The primary composition form uses a caller-owned postmaster:

```ts
const postmaster = await PGlitePostmaster.create({ dataDir: './pgdata' })
const server = await PGliteServer.create({
  postmaster,
  listen: { host: '127.0.0.1', port: 5432 },
})
```

Closing this server stops admission, drains socket bridges, and closes its
listeners, but does not close the caller-owned postmaster. A convenience form
may accept postmaster creation options. In that form the server owns the
created postmaster and closes it after its listeners using the requested
PostgreSQL shutdown mode. Listener startup failure never silently closes a
caller-owned postmaster, while unexpected postmaster exit always closes every
listener attached to it.

It must preserve the pluggable VFS contract exposed by the core API. A direct
Node filesystem can be the CLI default when the server creates its postmaster,
but third-party backends are selected through core postmaster options and never
implement a server-specific filesystem interface.

The socket frontend currently implemented in `packages/pglite-socket` is the
starting point for this package, subject to API review and renaming.

### 6.3 `@electric-sql/pglite-tools`

The tools package owns programmatic wrappers and distributable artifacts for
PostgreSQL utilities. It currently exposes `pg_dump`; the CLI design requires a
tool-runner contract that can be extended to additional programs without
putting their implementations in the CLI package.

Candidate tools include:

- `pg_dump`;
- `pg_restore`;
- `psql`;
- `pg_isready`;
- `createdb` and `dropdb`;
- `createuser` and `dropuser`;
- `vacuumdb` and `reindexdb`.

`initdb` will be a public Node TypeScript API in
`@electric-sql/pglite-tools/initdb` as well as a CLI command. It will use the
core package's `_internal/initdb-runtime` implementation and existing initdb
artifact rather than compile or carry a second copy. The core embedded runtime
may continue to call the same initializer through its local implementation
boundary.

The `./initdb` export is Node-only. Importing the existing tools root or
`./pg_dump` subpath must not eagerly load Node filesystem modules or the
standalone bootstrap host.

The tools package also owns the generic native-style command-runner interface
described in Section 9.3. High-level convenience functions such as the existing
`pgDump({ pg })` remain supported APIs, but they are wrappers around or siblings
of the native-style runner rather than the implementation used directly by the
CLI.

### 6.4 `pglite`

The unscoped distribution package owns:

- the `pglite` executable;
- subcommand discovery and top-level help;
- CLI-only configuration resolution;
- conversion of terminal signals into supported server shutdown requests;
- mapping typed failures to diagnostics and exit status;
- explicit re-exports from the scoped packages;
- compatibility checks across the installed package set.

It does not own SQL execution, sockets, Worker management, VFS implementations,
or Wasm tool entry points.

### 6.5 `@electric-sql/pglite-socket`

The socket package retains the classic API and architecture for compatibility.
It may be maintained without receiving new multi-session features. Its README
should direct new server deployments to `pglite` or
`@electric-sql/pglite-server`.

The public registry currently contains the classic `0.2.7` release, while the
branch's rewritten `0.3.0` package has not been published. The exact restoration
source is tag `@electric-sql/pglite-socket@0.2.7`, commit `25d0a55e1`. The
rewritten code can therefore move into `@electric-sql/pglite-server`; it must
not be published as `@electric-sql/pglite-socket@0.3.0` first.

Once the reusable multi-session frontend and its applicable tests have been
ported out, `packages/pglite-socket` should be restored at the content level to
its pre-rewrite classic implementation. This is essentially a revert of the
package directory, not an attempt to reshape the rewritten multi-session code
back into the classic architecture. Only fixes that are independently useful
and verified against the classic implementation should be carried across. Its
manifest, exports, documentation, changelog, and tests must again describe the
published classic line.

### 6.6 Repository ownership and move map

The reorganisation should move code according to responsibility rather than
moving the current branch's directories wholesale:

| Current branch content                                                    | Destination                                | Treatment                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pglite/src/postmaster/**`                                       | `packages/pglite/src/postmaster/**`        | Keep in core; split platform-neutral code from `node/` code without changing behavior in Phase 1                                  |
| `packages/pglite/src/wasm/multi-memory.ts` and related runtime helpers    | Core postmaster shared/runtime directories | Keep in core; make ownership clear and retain focused unit tests                                                                  |
| Postmaster, session, process, memory, Worker, and VFS tests               | Core package test suites                   | Keep with the implementation; remove obsolete proof-of-concept fixtures only after equivalent behavior is covered                 |
| Rewritten multi-session `packages/pglite-socket/src/**` frontend          | `packages/pglite-server/src/**`            | Move and rename around `PGliteServer`; remove postmaster/runtime ownership from it                                                |
| Rewritten multi-session socket integration tests                          | `packages/pglite-server` integration tests | Retain only listener, transport, composition, and lifecycle coverage                                                              |
| Rewritten `packages/pglite-socket/**` after extraction                    | `packages/pglite-socket/**`                | Restore the directory to the pre-rewrite classic implementation; carry over only independently justified and tested classic fixes |
| Multi-memory Wasm transformer and artifact-audit tooling                  | `tools/wasm-multi-memory/**`               | Keep as build tooling; it produces core-owned postmaster artifacts                                                                |
| `tests/postmaster/regression-server.mjs` and regression lifecycle harness | Server or CLI regression integration area  | Keep outside the transformer directory once it tests packaged hosting rather than Wasm transformation                             |
| `tests/postmaster/artifact-audit.mjs` and artifact build wrappers         | Core postmaster artifact integration area  | Keep artifact validation with the core-owned artifact; invoke Docker-contained tooling rather than host-installed tools           |
| PostgreSQL fork changes                                                   | `postgres-pglite` submodule                | Keep minimal and behind PGlite libc/fenced integration points; commit the submodule first and then the parent pointer             |

No browser runtime implementation files are introduced by this move. A future
browser phase may populate the reserved platform boundary without relocating
the shared public API or the platform-independent protocols again.

### 6.7 Deferred browser compatibility boundary

Browser support is an architectural invariant for this reorganisation, not a
deliverable or test matrix for its Node implementation phases. In particular:

- the shared public postmaster and session surface must not require Node stream,
  Worker, filesystem-path, or socket types; platform-specific creation options
  may extend it behind their platform entry points;
- shared process, signal, connection, memory, and VFS protocols must not assume
  that the coordinator is a Node Worker thread;
- Node-only constructors and adapters are reached through an explicit platform
  boundary and cannot enter browser-selected module graphs;
- browser storage ownership, Web Locks, SharedWorker coordination, OPFS
  executors, and multi-tab recovery remain specified and implemented by the
  separate browser design;
- the package must not advertise browser multi-session support until that
  implementation and its browser test matrix exist.

The Node phases need only enforce these seams and avoid decisions that would
make the browser implementation require another public API or package move.

## 7. Public programmatic API

### 7.1 Root API

The root import re-exports the common embedded API:

```ts
import { PGlite } from 'pglite'

const db = await PGlite.create('file://./pgdata')
```

The re-export must preserve type identity. The umbrella package must not wrap
or subclass `PGlite` merely to change its package name.

### 7.2 Postmaster subpath

The umbrella distribution re-exports the core postmaster without wrapping it:

```ts
import { PGlitePostmaster } from 'pglite/postmaster'

const postmaster = await PGlitePostmaster.create({
  dataDir: './pgdata',
})

const session = await postmaster.createSession()
await session.query('select 1')
```

The canonical scoped import is available in Node and, in a later independent
browser implementation phase, supported browsers:

```ts
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
```

Sessions expose the normal `PGliteInterface`. The Node and browser runtimes may
use different internal orchestration without changing these public types.

### 7.3 Server subpath

```ts
import { PGlitePostmaster } from 'pglite/postmaster'
import { PGliteServer } from 'pglite/server'

const postmaster = await PGlitePostmaster.create({ dataDir: './pgdata' })
const server = await PGliteServer.create({
  postmaster,
  listen: {
    host: '127.0.0.1',
    port: 5432,
  },
})

await server.close()
await postmaster.close({ mode: 'smart' })
```

The scoped import remains available for users who do not want the complete
distribution:

```ts
import { PGliteServer } from '@electric-sql/pglite-server'
```

`PGliteServer` is a composition boundary rather than an alias for the
postmaster. The postmaster owns the database cluster and sessions; the server
owns externally reachable listeners.

A convenience form can create an owned postmaster:

```ts
const server = await PGliteServer.create({
  postmaster: {
    dataDir: './pgdata',
    maxConnections: 20,
  },
  listen: { host: '127.0.0.1', port: 5432 },
})

await server.close({ mode: 'smart' })
```

In the convenience form, `close({ mode })` stops listeners and then shuts down
the owned postmaster. Passing a shutdown mode to a server with a caller-owned
postmaster is rejected rather than changing ownership implicitly.

### 7.4 Tools subpath

The umbrella package may explicitly re-export stable programmatic tool APIs:

```ts
import { pgDump } from 'pglite/tools'
```

This should use an explicit export list. Broad `export *` declarations across
several packages risk name collisions and unintentionally make implementation
details part of the umbrella API.

### 7.5 `initdb` TypeScript API

`initdb` is a supported Node API, not CLI-only glue:

```ts
import { initdb } from '@electric-sql/pglite-tools/initdb'

const result = await initdb({
  dataDir: './pgdata',
  args: ['--encoding=UTF8', '--auth=scram-sha-256'],
})

console.log(result.dataDir)
```

It is also available from the umbrella distribution:

```ts
import { initdb } from 'pglite/tools'
```

The high-level API is:

```ts
export interface InitdbOptions {
  dataDir: string | URL
  args?: readonly string[]
  env?: Readonly<Record<string, string | undefined>>
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
  signal?: AbortSignal
}

export interface InitdbResult {
  dataDir: URL
  exitCode: number
}

export function initdb(options: InitdbOptions): Promise<InitdbResult>
```

A URL data directory must use the `file:` scheme in the initial Node API. Other
schemes are rejected unless a future overload also receives an explicit PGlite
filesystem implementation.

The default streams are the current process streams. Programmatic callers can
supply streams to capture output without the initializer maintaining a second
string-buffered execution path. Invalid arguments and ordinary PostgreSQL
initialization failures return the native exit status; JavaScript host failures
such as an unreadable artifact or broken VFS reject the promise with a typed
error.

`dataDir` is authoritative. If `args` also contains `-D` or `--pgdata`, the API
must either require the same normalized location or reject the conflicting
configuration. It must never initialize one path while reporting another.

The TypeScript API and CLI share native `initdb` defaults. In particular, the
public API must not silently prepend the current embedded wrapper's
`--auth=trust`, locale, encoding, or group-access flags. Changing any previously
exposed TypeScript defaults to achieve this is an accepted breaking change. The
classic embedded `PGlite` constructor may continue to request explicit
embedded-runtime defaults when it invokes the shared initializer internally.

### 7.6 Standalone initialization architecture

The initializer must run before a `PGlite` instance or postmaster exists. The
core `_internal/initdb-runtime` contract therefore provides a standalone
bootstrap host with:

- the initdb Wasm program;
- the matching bootstrap-mode PostgreSQL entry point needed by initdb;
- a mount of the normalized host data directory at the Wasm `PGDATA` path;
- stdin, stdout, stderr, environment, cancellation, and exit-code adapters;
- access to the matching locale and timezone data;
- cluster-manifest creation after PostgreSQL initialization succeeds.

The internal entry point exports an explicit runner and its contract identity;
it does not wildcard-export the existing embedded initializer:

```ts
export interface InitdbRuntimeInvocation {
  readonly dataDir: string
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdin: NodeJS.ReadableStream
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

export interface InitdbRuntimeResult {
  readonly exitCode: number
  readonly manifest: PGliteClusterManifestV1
}

export function runInitdbRuntime(
  invocation: InitdbRuntimeInvocation,
): Promise<InitdbRuntimeResult>

export const initdbRuntimeIdentity: PGliteContractRequirement
```

The core implementation owns path mounting, bootstrap Wasm, manifest creation,
and host-failure classification. The tools package owns the documented public
API, defaults, and stream selection. Ordinary PostgreSQL exit statuses are
returned; invalid host setup, artifact mismatch, and I/O adapter failure reject
with typed core errors.

For the Node CLI and Node TypeScript API, the initial host mount uses the same
direct Node filesystem implementation as the core Node postmaster. The internal Wasm path
such as `/pglite/data` is an implementation detail and must not replace the
caller's host path in diagnostics or results.

The bootstrap PostgreSQL build must match the core postmaster build's PostgreSQL major,
catalog format, block sizes, checksum capabilities, and other disk-format
settings. It does not need the postmaster's multi-memory execution topology merely
to create files, but compatibility is proved by build metadata and an
integration test that starts the released postmaster on the resulting cluster.

`pglite postgres` follows native PostgreSQL behavior and refuses to start on a
missing or uninitialized data directory. It does not implicitly run `initdb`.
The friendlier `pglite server` alias may gain an explicit `--init` option later,
but there is no implicit initialization in the first release.

## 8. Package manifest shape

The tools package adds a Node-only `./initdb` export without changing the
loading behavior of its existing root or `./pg_dump` exports. Its public export
map must include TypeScript declarations and whichever ESM/CommonJS formats the
project continues to support. Any CLI-only runner registry is exposed through
an explicitly named first-party internal subpath rather than the tools root.

An illustrative, non-final `packages/pglite-cli/package.json` is:

```json
{
  "name": "pglite",
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "bin": {
    "pglite": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./postmaster": {
      "types": "./dist/postmaster.d.ts",
      "import": "./dist/postmaster.js",
      "require": "./dist/postmaster.cjs"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js",
      "require": "./dist/server.cjs"
    },
    "./tools": {
      "types": "./dist/tools.d.ts",
      "import": "./dist/tools.js",
      "require": "./dist/tools.cjs"
    },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@electric-sql/pglite": "0.0.0",
    "@electric-sql/pglite-server": "0.0.0",
    "@electric-sql/pglite-tools": "0.0.0"
  }
}
```

Workspace manifests will use the repository's workspace protocol during
development. Published manifests must resolve to compatible released versions.

The executable must begin with the Node shebang and be included in the package
tarball with executable permissions.

## 9. CLI contract

### 9.1 Command grammar

```text
pglite [global-options] <command> [command-options] [arguments]
```

The initial interface should include:

```sh
pglite help
pglite version
pglite initdb ...
pglite postgres ...
pglite server ...
pglite pg_isready ...
```

`server` and `postgres` deliberately have different contracts:

- `server` is the PGlite-oriented Node hosting command. It exposes documented
  PGlite listener and postmaster options and may later gain an explicit `--init`
  convenience.
- `postgres` is the compatibility-oriented spelling. It passes PostgreSQL
  arguments through, never initializes implicitly, and is advertised only after
  PostgreSQL's effective socket operations drive the Node listeners.

They may share the same `PGliteServer` and postmaster implementation, but
`server` is not an alias that weakens the compatibility promises of `postgres`.

Later commands can include:

```sh
pglite psql ...
pglite pg_dump ...
pglite pg_restore ...
pglite createdb ...
pglite dropdb ...
```

Running `pglite` without a command prints concise help and exits successfully.
It must not unexpectedly initialize a directory or start a long-lived server.

### 9.2 PostgreSQL compatibility target

For a PostgreSQL-derived command, compatibility means:

- familiar option names and meanings;
- the same positional argument interpretation where practical;
- stdout for normal results and stderr for diagnostics;
- useful PostgreSQL-compatible exit status;
- correct stdin handling for passwords, SQL, or archive data;
- no acceptance of unsupported options unless they have an implemented effect;
- help text that identifies intentional differences.

Invocation spelling is intentionally different:

```text
Native PostgreSQL:  initdb -D ./pgdata
PGlite:             pglite initdb -D ./pgdata
```

The CLI dispatcher should avoid reparsing all PostgreSQL arguments. After it
identifies the command and consumes documented PGlite-global options, it should
pass the remaining argument vector to that command's adapter. Where the actual
PostgreSQL Wasm entry point can consume the original arguments safely, the
adapter should preserve them.

CLI commands use the matching native PostgreSQL defaults. PGlite must not
inject convenience flags, connection parameters, output formats, users,
parallelism limits, or authentication modes into the PostgreSQL argument
vector. If the Wasm environment forces a different default, the compatibility
table must identify it and the test suite must pin the difference. The same
rule applies to the public native-style TypeScript runners; a higher-level
convenience API may remain opinionated when its options document that behavior.

### 9.3 Native-style tool-runner contract

The CLI is backed by a streaming runner rather than the current high-level
`pgDump({ pg })` interface:

```ts
export interface PostgresToolInvocation {
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  signal?: AbortSignal
  cwd?: string | URL
}

export interface PostgresToolRunner {
  readonly command: string
  run(invocation: PostgresToolInvocation): Promise<number>
}
```

The runner contract has these requirements:

- `argv` contains the arguments following the command name and is not rewritten
  except for documented host-path mapping;
- PostgreSQL environment variables such as `PGHOST`, `PGPORT`, `PGDATABASE`,
  `PGUSER`, `PGPASSFILE`, and `PGSERVICE` are propagated;
- stdout and stderr are written incrementally with backpressure rather than
  accumulated in memory;
- stdin remains interactive for commands such as `psql` and password handling;
- the promise resolves to the PostgreSQL program's exit code;
- failure to instantiate the Wasm program, mount required paths, or create the
  transport rejects with a typed host error;
- abort requests are translated to the closest supported PostgreSQL
  cancellation or termination behavior and are never treated as success;
- each invocation owns fresh Emscripten process state unless a tool has been
  explicitly proven safe to reuse.

Client utilities use their normal libpq connection model through PGlite's
TCP/Unix-socket host abstraction. They must not depend on an in-process
`PGlite.execProtocolRawStream()` connection when invoked through this runner.
This makes `-h`, `-p`, service files, password files, connection errors, and
server cancellation observable through the same path as native clients.

The existing `pgDump({ pg })` API remains an embedded convenience API. It can
continue to return a `File` and choose opinionated defaults, but the CLI does
not call it. Shared Wasm artifact loading and low-level tool initialization
should be factored beneath both APIs where practical.

`initdb` implements the same stream and exit-code semantics, but uses the
standalone bootstrap host described in Section 7.6 rather than libpq.

### 9.4 Native `postgres` configuration and listeners

The `postgres` subcommand must treat PostgreSQL as the authority for ordinary
server configuration. Node must not implement a second partial parser for
`postgresql.conf`, `-c name=value`, included configuration files, environment
expansion, port selection, or Unix socket directory settings.

The postmaster's socket host reports its effective `bind()`, `listen()`, and
socket-close operations to the supervisor. `PGliteServer` materializes the
corresponding Node TCP, IPv6, and Unix-domain listeners and returns accepted
connections to the postmaster transport. This makes settings such as
`listen_addresses`, `port`, and `unix_socket_directories` take effect after
PostgreSQL itself has resolved command-line and configuration-file precedence.

The host bridge must preserve, where supported:

- loopback, wildcard, IPv4, and IPv6 bind intent;
- port `0` or bind-failure reporting semantics where PostgreSQL permits them;
- PostgreSQL Unix socket names and lock files;
- multiple configured Unix socket directories;
- file modes derived from `unix_socket_permissions`;
- startup failure when a required listener cannot be created;
- listener closure during the correct postmaster shutdown phase.

Unsupported address families or socket settings fail explicitly. They are not
accepted and ignored.

The programmatic `PGliteServer.create({ listen })` option is a convenience that
is translated into PostgreSQL startup settings before the postmaster resolves
configuration. It does not bypass the postmaster's effective listener state or
create a second independently configured listener. Conflicting programmatic and
PostgreSQL options are rejected or resolved using one documented precedence
rule.

This listener-driven path is a requirement for claiming that `pglite postgres`
behaves like the native binary. The existing socket frontend's independent
`host` and `port` defaults may be retained for a higher-level `pglite server`
mode only when the differences are explicit.

### 9.5 PGlite-specific options

PGlite-specific options must not take over plausible PostgreSQL flags. Use a
`--pglite-` prefix or environment variables for runtime controls:

```sh
pglite postgres \
  -D ./pgdata \
  -p 5432 \
  --pglite-max-sessions=20 \
  --pglite-private-memory-limit=512MiB
```

Equivalent environment variables may include:

```text
PGLITE_MAX_SESSIONS
PGLITE_PRIVATE_MEMORY_LIMIT
PGLITE_GLOBAL_MEMORY_LIMIT
PGLITE_LOG_LEVEL
```

Names and units must be shared with the programmatic server options where
possible.

Global PGlite options are accepted only before the subcommand. Server-specific
`--pglite-*` options after `postgres` or `server` are owned by that command's
adapter. A literal `--` ends PGlite option processing and preserves every
following argument for the PostgreSQL program.

### 9.6 Process lifecycle

The first release runs in the foreground. It must implement native postmaster
signal intent:

- `SIGTERM` requests smart shutdown;
- `SIGINT` requests fast shutdown;
- `SIGQUIT` requests immediate shutdown;
- `SIGHUP` requests PostgreSQL configuration reload;
- rejection of new connections during shutdown;
- Worker and socket cleanup;
- Unix socket file cleanup when owned by this process;
- deterministic exit after successful shutdown;
- non-zero exit for startup or unexpected runtime failure;
- prevention of two server processes unsafely owning the same data directory.

The signal handler must request shutdown through public server APIs rather than
reaching into Worker or Wasm internals.

### 9.7 `pg_ctl`

Native `pg_ctl` assumes native process spawning, background operation, PID
files, and OS signals. Those semantics do not automatically follow from the
postmaster running in a Node process.

The initial CLI should omit `pg_ctl`. A later limited implementation may expose
`start --foreground`, `stop`, and `status` only after lifecycle, ownership, and
stale-state behavior are specified and tested. Unsupported native operations
must fail explicitly.

### 9.8 Executable aliases

Initially publish only the `pglite` bin. Do not publish bins named `postgres`,
`initdb`, or `psql`, because npm can place them into projects alongside native
PostgreSQL installations and cause surprising command resolution.

Optional prefixed aliases such as `pglite-postgres` can be considered later if
real integration use cases require separate executable names.

## 10. Filesystems and data directories

The CLI's initial persistent default is the existing direct Node filesystem
backend. Paths accepted through `-D` must have a documented resolution policy;
relative paths resolve from the current working directory.

Initialization and server startup normalize paths through the same function.
The CLI reports the resolved host path before destructive initialization. An
existing non-empty directory that is not a valid PostgreSQL cluster is rejected
according to native `initdb` behavior rather than partially reused.

The programmatic postmaster API continues to accept the existing pluggable
PGlite filesystem contract. The server passes filesystem options to an owned
postmaster or accepts an already constructed postmaster; it never introduces a
second VFS API.

Multi-process filesystems need capabilities that the original single-instance
contract did not have to express. Core may add optional capability metadata and
worker-aware factory or cluster-lock hooks to the existing VFS contract. At a
minimum the runtime must distinguish:

- direct construction in process Workers;
- safe supervisor/coordinator brokering;
- persistent exclusive cluster ownership;
- unsupported multi-session access.

Existing objects remain valid for the classic API. A compatible object may run
behind the bounded synchronous broker, but the plan does not claim arbitrary
third-party objects are cloneable or multi-process safe. Browser-specific OPFS
coordinator and executor implementations are deferred to the browser plan; the
capability vocabulary introduced by Node must leave room for them.

Arbitrary JavaScript filesystem objects cannot be expressed through command
line flags. If CLI configuration for third-party VFS implementations is needed,
add an explicit Node configuration-module mechanism later. Do not encode
package importing or evaluation into `-D`.

Migration to Emscripten WasmFS is independent of this distribution design. It
should occur only if it improves the underlying filesystem architecture and
can preserve the PGlite VFS contract; it is not required to implement the CLI.

## 11. Artifact ownership and package size

Each artifact should ship in the narrowest package that owns its runtime:

| Artifact                                             | Intended owner                |
| ---------------------------------------------------- | ----------------------------- |
| Classic single-user PGlite Wasm                      | `@electric-sql/pglite`        |
| Multi-session postmaster Wasm and process assets     | `@electric-sql/pglite`        |
| Node TCP/Unix listener JavaScript                    | `@electric-sql/pglite-server` |
| Future browser coordinator/executor assets           | `@electric-sql/pglite`        |
| `pg_dump`, `pg_restore`, `psql`, and other tool Wasm | `@electric-sql/pglite-tools`  |
| Public `initdb` Node adapter                         | `@electric-sql/pglite-tools`  |
| Shared initdb and bootstrap runtime artifact         | `@electric-sql/pglite`        |
| CLI JavaScript and help metadata                     | `pglite`                      |

The core package therefore carries both classic and multi-session artifacts.
This is intentional because both are embedded APIs and the postmaster is not a
Node server feature. The current proof-of-concept baseline is approximately
9.6 MB raw/3.4 MB gzip for the classic Wasm and 13 MB raw/4.1 MB gzip for the
multi-session Wasm. A distinct multi-session data payload could add roughly
6.1 MB raw/1.9 MB gzip. Before publication, the build must determine whether
the classic and multi-session runtimes can consume one data payload and avoid
duplicate packaged content where their virtual files are identical.

Importing the core root must not load, instantiate, or cause a bundler to emit
the multi-session Wasm or its Worker entries. Importing the postmaster subpath
loads only the selected platform runtime and resolves artifacts relative to the
installed core package. Node and browser artifact URLs must survive ESM, CommonJS
where supported, bundling, and packed-tarball installation without external
runtime downloads.

The initdb and matching bootstrap artifact remain beside the core artifact
because normal embedded `PGlite` initialization already requires them. The
tools package consumes them through `_internal/initdb-runtime` and supplies the
public Node TypeScript adapter. Neither the tools nor CLI package copies those
artifacts.

The umbrella package intentionally installs all of its dependencies and is not
the minimal distribution. Users selecting `@electric-sql/pglite`,
`@electric-sql/pglite-server`, or `@electric-sql/pglite-tools` directly retain
control over installed network and tool dependencies. Core users still install
the opt-in multi-session artifact, so its compressed size remains a published
core-package budget.

Do not use optional dependencies followed by runtime installation. `npx pglite`
must be reproducible and usable without mutating its installation after launch.

Release checks must record:

- unpacked and compressed size of every package;
- the artifact contribution by command;
- duplicate Wasm artifacts across packages;
- duplicate classic/multi-session data payload contents within core;
- whether root imports cause Node-only modules or tool artifacts to be loaded;
- whether root imports cause postmaster Wasm or Worker assets to be emitted;
- whether the existing browser root graph remains free of new `node:*` modules;
- whether platform-neutral postmaster source imports any Node-only module;
- whether browser users of the existing scoped core API see any size regression.

## 12. Versioning and compatibility

The core postmaster runtime and tool artifacts share PostgreSQL, Emscripten, and
PGlite ABI assumptions. The server has no Wasm artifact, but its narrow
network-host contract must match the core version. An arbitrary semver-compatible
combination may still be invalid if an internal runtime ABI changes.

The first releases should use coordinated versions and resolve the umbrella
package to exact tested package versions. Changesets can still describe each
package independently, but the release process must update `pglite` whenever a
dependency combination changes.

Before starting a server or tool, the distribution should be able to detect and
report an incompatible installed package set. Exact dependency resolution is
the primary defense; runtime ABI metadata remains useful for copied artifacts,
monorepo development, package-manager overrides, and diagnostics.

### 12.1 Runtime ABI identity

Core publishes machine-readable identity for each Wasm artifact:

```ts
interface PGliteArtifactIdentity {
  postgresVersion: string
  postgresVersionNum: number
  catalogVersion: number
  pgliteAbiVersion: number
  transformerAbiVersion: number
  emscriptenVersion: string
  memoryTopology: 'classic' | 'multi-memory'
  pointerWidth: 32 | 64
  artifactSha256: string
  buildId: string
}
```

Packages that consume a first-party contract publish a separate contract
requirement rather than copying or pretending to own an artifact identity:

```ts
interface PGliteContractRequirement {
  coreVersion: string
  contract: 'node-network-host' | 'initdb-runtime'
  abiVersion: number
}
```

Consumers compare only fields relevant to the operation. A client tool does not
need the postmaster's memory topology, while every postmaster process artifact
must match its core supervisor or future browser coordinator's complete
artifact identity. The server checks its `node-network-host` requirement and
the tools adapter checks its `initdb-runtime` requirement; neither claims
ownership of the Wasm identity. The build generates artifact fields from
authoritative PostgreSQL, Emscripten, transformer, and artifact inputs rather
than maintaining them manually. `buildId` must be reproducible or
content-derived, not a timestamp.

### 12.2 Persistent cluster identity

Exact npm versions do not protect a data directory that outlives an
installation. Every initialized data directory therefore has:

- PostgreSQL's native `PG_VERSION` and control-file identity;
- a small versioned PGlite manifest under `PGDATA/.pglite/cluster.json`;
- an associated cross-runtime ownership lock used by both classic `PGlite`
  and the multi-session postmaster.

The manifest records only disk-compatibility and diagnostic information, not
unnecessarily restrictive JavaScript package versions:

```ts
interface PGliteClusterManifestV1 {
  manifestVersion: 1
  postgresMajor: number
  catalogVersion: number
  systemIdentifier: string
  blockSize: number
  walBlockSize: number
  dataChecksums: boolean
  encoding: string
  localeProvider: string
  createdByPGliteVersion: string
  createdByBuildId: string
}
```

The initializer writes the manifest atomically only after native initdb and its
bootstrap PostgreSQL steps succeed. If manifest creation fails, initialization
fails visibly rather than leaving a cluster that PGlite later treats as fully
owned.

Startup validates native PostgreSQL metadata first and the PGlite manifest
second. It refuses incompatible PostgreSQL majors, catalog versions, page
formats, or storage features before starting a Worker that can modify the
cluster. The initial release rejects a missing manifest on an otherwise valid
native PostgreSQL directory. A future explicit import/adoption command may
create one after validating the directory; ordinary server startup never does
so silently.

Classic and multi-session PGlite may open the same compatible cluster
sequentially. They may never own it concurrently. Both modes acquire the same
exclusive host lock before recovery or mutation and release it only after all
database work and filesystem synchronization complete. Lock metadata includes
the owning PID, runtime mode, start time, and a random owner token, but metadata
alone is not an ownership proof because PIDs can be reused.

The initial Node implementation must use an operating-system-held advisory lock
or another backend-provided exclusive lease with equivalent crash behavior. If
the selected filesystem cannot provide authoritative ownership, persistent
multi-session startup fails closed. Ambiguous stale state requires an explicit
administrative recovery action after validation; it is never cleared by age or
PID metadata alone. A later browser implementation uses the stable Web Lock and
generation-fencing protocol specified by the browser design, not the Node lock
implementation.

For the direct Node filesystem, the authoritative lock file is a hidden sibling
of `PGDATA`, named `.<directory-name>.pglite.lock`. Keeping it beside rather
than inside `PGDATA` is intentional: ownership must be acquired before initdb,
while native initdb requires an existing target directory to be empty. The
file stores diagnostic owner metadata while its open file description carries
the OS advisory lock. The file's presence is never itself proof of ownership,
and it may remain after clean shutdown or a crash. Canonicalizing `PGDATA`
before deriving the sibling path makes aliases and symlinks converge on the
same lock. Backend-provided lease implementations may use another location but
must provide the same exclusion and crash-release semantics.

Core expresses that requirement as a filesystem capability, shared by classic
and postmaster startup:

```ts
interface PGliteClusterLeaseMetadata {
  readonly ownerToken: string
  readonly runtime: 'classic' | 'postmaster'
  readonly pid?: number
  readonly startedAt: string
}

interface PGliteClusterLease extends AsyncDisposable {
  readonly ownerToken: string
  release(): Promise<void>
}

interface PGliteClusterLeaseProvider {
  acquireExclusiveClusterLease(
    canonicalDataDir: string,
    metadata: PGliteClusterLeaseMetadata,
  ): Promise<PGliteClusterLease>
}
```

Acquisition precedes initdb, recovery, manifest adoption, or any other cluster
mutation. The direct Node filesystem provides an OS-held implementation; a
third-party or brokered filesystem supplies an equivalent provider or declares
persistent multi-session access unsupported. The owner token is diagnostic and
generation-fencing state, not a substitute for the held lease. Release is
idempotent and occurs only after Workers stop and filesystem durability work
completes.

Opening a compatible cluster with a newer PGlite package does not rewrite its
manifest merely to update `createdByPGliteVersion`. A migration or storage
upgrade updates metadata only as part of an explicit, recoverable operation.

Core, server, and the umbrella distribution should enter a fixed coordinated
release group when the new packages are published. Starting the umbrella at the
next core version makes the tested combination apparent and avoids explaining
why `pglite@0.1` embeds a differently versioned PGlite runtime. Tools may retain
its independent public version, but the umbrella pins its exact tested release.

## 13. Testing strategy

### 13.1 Unit tests

`packages/pglite-cli` should test:

- command and global-option dispatch;
- preservation of command argument vectors;
- help and version output;
- error-to-exit-code mapping;
- signal-to-shutdown mapping with mocked public server APIs;
- explicit export identity;
- absence of side effects when importing `pglite` and its subpaths.

The server and tools packages test their own behavior. CLI unit tests should not
duplicate their internal test suites.

Core retains all postmaster, session, process-control, multi-memory, filesystem
broker, Worker, and artifact tests. The initial reorganisation must preserve
the existing Node postmaster test coverage without changing expected behavior.
Future browser runtime and OPFS tests also belong to core, but are outside this
plan. Static checks in these phases cover only the existing browser package
graph and the platform-neutral postmaster boundary; they do not constitute a
browser multi-session runtime test.

The server package tests only its composition and Node network-host concerns:

- caller-owned versus server-owned postmaster lifecycle;
- TCP, IPv4, IPv6, and Unix-domain listener behavior;
- raw protocol byte bridging and backpressure;
- listener failure and postmaster-exit propagation;
- socket path ownership and cleanup;
- translation of PostgreSQL-originated bind/listen operations where supported.

The tools package must contract-test every native-style runner with real Node
streams, environment variables, cancellation, backpressure, and non-zero exit
status. Tests for high-level convenience APIs are separate so an opinionated
wrapper cannot accidentally become the CLI execution path.

### 13.2 Packaged CLI tests

Tests must run the packed tarball, not only workspace source. In a clean
temporary project they should verify:

```sh
npx --yes --package=./pglite-*.tgz pglite --help
npx --yes --package=./pglite-*.tgz pglite initdb -D ./pgdata
npx --yes --package=./pglite-*.tgz pglite postgres -D ./pgdata -p <port>
```

The suite should then connect with a native PostgreSQL client, execute SQL,
stop the server, and verify cleanup and exit status.

Before the CLI exists, packed core and server tarballs must be tested together
in clean npm and pnpm projects. Those tests import the core root, core
postmaster, and server subpaths; create both caller-owned and server-owned
postmasters; resolve Worker and Wasm assets from the packed installation; and
verify that exact peer resolution produces one core identity.

Initialization tests must cover native default behavior, explicit
`--auth`, `--auth-host`, and `--auth-local`, conflicting `dataDir`/`-D` inputs,
non-empty invalid directories, stream redirection, and cancellation. The
resulting cluster must start successfully with the packed server package.

Persistent-directory tests must cover compatible sequential classic/postmaster
use, concurrent ownership rejection in both directions, incompatible manifest
rejection before mutation, incomplete initialization, and safe stale-lock
recovery.

Test both ESM and CommonJS programmatic imports if both are declared in package
exports. Run package export validation with the same standard used by the
existing packages.

### 13.3 PostgreSQL regression suites

The CLI server provides the stable process boundary for upstream regression
tests, but it is not by itself a replacement for PostgreSQL's test lifecycle.
Native `make check` normally asks `pg_regress` to create and control a temporary
installation and native server, whereas `make installcheck` targets an existing
server. PGlite therefore supplies a regression lifecycle adapter inside the
Wasm builder/test Docker image.

The adapter:

- preserves the upstream test schedules, parallel groups, SQL inputs, expected
  files, result comparison, and diff reporting;
- replaces only temporary cluster initialization, server startup, readiness,
  connection arguments, and shutdown;
- launches the packed `pglite` CLI rather than a workspace-only script;
- exposes the exact host and port or Unix socket to the native test driver;
- propagates server logs and unexpected exit status into the regression
  failure artifacts;
- records tests skipped because of an intentional Wasm or PGlite limitation;
- never edits upstream expected files merely to make a failure pass.

The supported workflow is:

1. create a fresh data directory;
2. run packed `pglite initdb` through the lifecycle adapter;
3. launch packed `pglite postgres` on an isolated TCP or Unix socket;
4. wait using `pglite pg_isready` or an equivalent readiness probe;
5. invoke `pg_regress` and the surrounding `make check` or `make check-world`
   targets through the adapter;
6. preserve upstream schedules, parallelism, expected-output comparison, and
   failure artifacts;
7. stop the server and verify Worker and socket cleanup.

The regression adapter belongs with postmaster integration testing, not in the
CLI's unit-test directory. The CLI is the executable under test but should not
contain PostgreSQL regression logic. The repository must give the adapted
targets distinct, documented entry points if invoking unmodified `make check`
would still select the native lifecycle; it must not imply that an ordinary
upstream target automatically discovers PGlite.

### 13.4 Compatibility tests

For each implemented PostgreSQL command, compare representative behavior with
the matching native PostgreSQL version:

- `--help` and `--version` structure;
- successful and failing argument parsing;
- stdout versus stderr routing;
- exit status;
- connection environment variables;
- password and stdin handling;
- cancellation and termination;
- PostgreSQL configuration precedence for listener addresses, ports, Unix
  socket directories, and `SIGHUP` reload;
- native `SIGTERM`, `SIGINT`, and `SIGQUIT` shutdown modes.

The test objective is documented compatibility, not snapshotting incidental
whitespace from the native programs.

## 14. Documentation

The product-level distinction should be prominent:

```text
Use @electric-sql/pglite when embedding PGlite in an application.
Use pglite when installing the complete Node server and command suite.
Use @electric-sql/pglite/postmaster for embedded multi-session databases.
Use @electric-sql/pglite-server to expose a core postmaster over Node sockets.
```

Documentation must cover:

- package selection;
- Node.js version requirements;
- server startup and shutdown;
- filesystem and data-directory behavior;
- PostgreSQL command compatibility and known differences;
- package and artifact size;
- migration from the rewritten branch version of `pglite-socket`;
- maintenance status of the classic socket package;
- security implications of listening on non-loopback interfaces.

Examples should default to loopback listeners. Unix socket permissions and TCP
authentication defaults must be explicit.

## 15. Security and operational defaults

The default server must not unexpectedly expose a database to the network.

- TCP defaults to loopback only.
- A non-loopback bind should produce a visible warning unless explicitly
  acknowledged by configuration.
- Unix sockets use restrictive permissions by default.
- Authentication behavior must follow the initialized PostgreSQL cluster and
  must not be bypassed by the socket frontend.
- Public CLI and TypeScript `initdb` invocations use the matching native
  PostgreSQL authentication defaults and warnings. They do not silently inject
  `--auth=trust` or rewrite `--auth`, `--auth-host`, or `--auth-local`.
- When native defaults produce trust authentication, the complete native
  warning is preserved. Server startup does not silently change the generated
  HBA rules; any additional listener warning must be informational and based on
  policy the server can reliably determine.
- Passwords must not appear in debug logs or process-title output.
- Shutdown must not delete socket paths it does not own.
- Data-directory ownership and permission failures must stop startup.

Cluster ownership, PostgreSQL authentication, HBA enforcement, connection
admission, and database shutdown belong to the core postmaster. Listener
addresses, non-loopback warnings, socket permissions, transport cleanup, and
network diagnostics belong to `@electric-sql/pglite-server`. The CLI selects
and documents defaults but does not independently reimplement either layer's
security checks. Initialization policy and argument fidelity belong in the
shared initdb runtime and its tools-package adapter. Integration tests must
verify that unauthenticated and authenticated outcomes are determined by
`pg_hba.conf`, including separate host and local rules.

## 16. Migration plan

### Phase 0: validate names and package boundaries

- Verify the `pglite` and `@electric-sql/pglite-server` npm names and have an
  authenticated project owner reserve them. Source reorganisation may proceed
  after availability is verified, but neither package may be released until
  reservation is confirmed.
- Record that the branch-only postmaster export and rewritten socket `0.3.0`
  have not been published; preserve the published classic socket line.
- Measure current core, postmaster, socket, and tool artifacts.
- Fix `@electric-sql/pglite/postmaster`, `pglite/postmaster`, and
  `pglite/server` as distinct public entry points.
- Record the core/tool runtime identity and the narrow core/server network-host
  ABI needed for compatibility checks.
- Define the public raw-protocol connection contract and the strict-listener
  symbols in `_internal/node-network-host` and
  `_internal/initdb-runtime`; reject wildcard internal exports.
- Specify caller-owned and server-owned postmaster lifecycle semantics.
- Specify the Node persistent cluster manifest and authoritative lock protocol,
  including fail-closed handling for filesystems without safe locking.
- Record the source, test, artifact, and build-tool ownership map.
- Put core, server, and the umbrella package in a coordinated release group and
  define exact peer and dependency resolution tests.

Exit criterion: published-name ownership, public exports, package ownership,
network and initdb contracts, runtime identity, lifecycle semantics, and Node
persistent-cluster compatibility rules are fixed.

Phase 0 repository decision record, 2026-07-14:

- npm returned `E404` for both proposed names, most recently reverified from the
  pinned Docker tool image on 2026-07-15. This verifies current registry
  availability but does not reserve either name; authenticated reservation is
  the remaining external release-owner action and is not represented as a code
  change.
- The branch-only `@electric-sql/pglite/postmaster` export and socket `0.3.0`
  rewrite are unpublished. The socket restoration source is
  `@electric-sql/pglite-socket@0.2.7` at `25d0a55e1`.
- Explicit PGlite-managed listeners use the existing public
  `openProtocolConnection()` byte-stream contract. PostgreSQL-controlled
  listeners require the generation-fenced `_internal/node-network-host`
  attachment defined in Section 6.
- Browser/default resolution of the initial postmaster subpath uses the
  unsupported-platform stub; Node resolution uses the Worker-thread runtime.
  Browser multi-session behavior remains outside this plan.
- The artifact baseline is 10,101,264 bytes raw/3,399,141 bytes gzip for classic
  Wasm, 14,105,638/4,097,957 for postmaster Wasm, 6,325,839/1,854,088 for the
  classic data payload, 6,364,934/1,868,727 for the current postmaster data
  payload, and 409,565/146,585 for initdb Wasm. Duplicate data payload work is
  therefore a release-size gate.
- Core, server, socket, tool, test, Docker-tooling, and PostgreSQL-submodule
  ownership follows the table in Section 6.6. PostgreSQL fork changes remain
  fenced behind PGlite libc and are committed in the submodule before the
  parent pointer.
- The runtime, host-contract, cluster manifest, lease, postmaster ownership,
  and server lifecycle contracts in Sections 6, 7, and 12 are the implementation
  contracts. Core, server, and the umbrella package use a coordinated release
  group; server and tools declare exact compatible core peers.
- The pre-change Node 24 ARM64 baseline passes core and socket typechecking,
  16 focused postmaster primitive/view tests, and seven rewritten-socket unit
  tests. Docker-backed postmaster integration remains the authoritative runtime
  gate; ad hoc integration invocation without its generated configuration is
  not a valid test run.

### Phase 1: reorganize the core Node postmaster without changing behavior

- Keep `PGlitePostmaster` and `@electric-sql/pglite/postmaster` in
  `packages/pglite`.
- Split the current source into platform-independent public/shared code and a
  Node runtime using `postmaster/shared` and `postmaster/node` boundaries.
- Reserve a clean future browser runtime boundary without implementing,
  exporting, or claiming browser multi-session support in this phase.
- Keep multi-memory helpers, process control, filesystem brokers, session
  behavior, Worker code, and postmaster artifacts in core.
- Move postmaster unit, stress, integration, and artifact-resolution tests to
  their final core-owned locations.
- Make the release build copy the transformed multi-session Wasm and Node Worker
  assets into the core package and resolve them relative to packed installs.
- Preserve the existing `PGlite` constructor, classic non-SAB build, root
  imports, and all existing extension and VFS behavior.
- Add build-graph checks that ordinary root imports do not include postmaster
  assets or Node-only code, that the existing browser root remains intact, and
  that platform-neutral postmaster modules do not import the Node runtime.

Exit criterion: the reorganized Node `PGlitePostmaster` passes the existing
artifact, primitive, session, stress, VFS, memory-churn, TypeScript, and classic
compatibility suites with no intentional runtime behavior change.

Phase 1 implementation record, 2026-07-14:

- The postmaster source is split into `postmaster/shared` and `postmaster/node`;
  browser/default resolution uses an explicit unsupported-platform stub and the
  ordinary package root remains independent of Node and postmaster modules.
- The normal package build copies the transformed postmaster Wasm, data, glue,
  and Worker artifacts into `dist`. Both ESM and CommonJS resolve those assets
  relative to a packed installation.
- Native ARM64 Docker builds pass the artifact and side-module audits, 16
  focused primitive/view tests, eight API/runtime tests, socket, libpq, COPY,
  and backpressure integration, 230 core regression tests, 119 isolation tests,
  and the 10,000-session memory/crash stress gate.
- The classic package suite passes 288 tests with one existing skip. TypeScript,
  lint, export-shape, root build-graph, fresh packed ESM, and fresh packed
  CommonJS checks pass without an intentional runtime behavior change.

### Phase 2: extract the Node network-server package

- Create `packages/pglite-server`.
- Move the multi-session socket frontend and CLI-independent lifecycle code out
  of `packages/pglite-socket`.
- Make it consume the core `PGlitePostmaster` and raw protocol connection API,
  with no imports of postmaster Worker, memory, filesystem, or artifact code.
- Implement and test caller-owned and server-owned `PGliteServer.create()`
  forms and their different shutdown behavior.
- Initially support the explicit PGlite-oriented TCP and Unix listener options
  required by `pglite server`.
- After the reusable frontend and tests have been ported, restore
  `packages/pglite-socket` to its pre-rewrite classic contents rather than
  adapting the rewritten implementation in place.
- Review any proposed retained changes individually, keep only fixes that apply
  to the classic implementation, and restore its manifest, exports,
  documentation, changelog, and tests to the classic release line.
- Run the restored package's classic unit and integration tests.
- Add clean npm and pnpm packed-tarball tests for core and server, including
  ESM and CommonJS where declared.

Exit criterion: a programmatic Node server accepts multiple real PostgreSQL
connections on explicit TCP and Unix listeners, preserves postmaster ownership
semantics, and shuts down without CLI code. The classic socket package remains
compatible with its published line.

Phase 2 implementation record, 2026-07-14:

- `@electric-sql/pglite-server` now owns the byte-transparent Node TCP and Unix
  listener bridge and exposes `PGliteServer.create()` with caller-owned and
  server-owned postmaster forms. Unexpected postmaster exit closes listeners;
  listener startup failure closes only a postmaster created by the server.
- Native `psql`, `pg_isready`, and `pgbench` clients pass through the extracted
  frontend over TCP and PostgreSQL-named Unix sockets. The server-owned form is
  also exercised against the real postmaster artifact and its requested
  shutdown mode.
- `packages/pglite-socket` is restored from the published `0.2.7` source at
  `25d0a55e1`, apart from formatting cleanup and a README migration notice. Its
  61 classic tests, TypeScript build, package build, and export checks pass.
- The new server's ten unit/lifecycle tests, TypeScript, lint, build, export
  checks, native integration gate, libpq/COPY/backpressure gate, and a targeted
  upstream regression schedule pass. Fresh npm and pnpm installs of packed core
  and server tarballs resolve both declared ESM and CommonJS entries.

### Phase 3: complete production Node hosting semantics

- Add optional VFS capability metadata and worker-aware factory or broker
  selection to core without breaking the classic filesystem API.
- Make classic and postmaster runtimes honor the same authoritative Node
  data-directory lock before recovery or mutation.
- Implement the narrow network-host path through which PostgreSQL's effective
  `bind()`, `listen()`, and close operations materialize Node listeners.
- Preserve PostgreSQL-selected IPv4, IPv6, Unix socket, permission, failure,
  and shutdown behavior where supported.
- Keep `pglite server`'s explicit PGlite listener mode distinct from the strict
  PostgreSQL-controlled mode used by `pglite postgres`.
- Add lifecycle, bind-failure, postmaster-exit, socket ownership, authentication,
  and concurrent-cluster ownership tests.

Exit criterion: a programmatic server can run in PostgreSQL-controlled listener
mode, accepts concurrent native clients, and safely rejects incompatible or
concurrent cluster ownership before mutation.

Browser note: the shared public types, process protocols, VFS capability
vocabulary, and artifact identity produced by Phases 1-3 must remain suitable
for the separate browser design. No SharedWorker, Web Lock, OPFS executor,
multi-tab, or browser capability implementation is part of these phases.

Phase 3 implementation record, 2026-07-14:

- Core exposes optional VFS capability metadata and uses one authoritative,
  generation-fenced Node cluster lease for classic and postmaster runtimes.
  Persistent runtimes fail closed when the backend cannot provide the required
  exclusive-lock semantics; existing third-party VFS implementations retain
  their source-compatible API.
- The narrow `_internal/node-network-host` attachment carries decoded IPv4,
  IPv6, and Unix bind requests. PostgreSQL remains authoritative for effective
  address, port, backlog, Unix mode, and Unix group policy. Listener IDs are
  generation-fenced, attachment is exclusive, late attachment replays desired
  listeners, and detach or postmaster exit closes only materialized listeners.
- `PGliteServer.create({ mode: 'postgres' })` is distinct from the existing
  explicit listener mode. It waits for a PostgreSQL-selected listener, exposes
  all effective addresses, propagates bind failures to PostgreSQL and the
  caller, and bridges accepted sockets through `openProtocolConnection()`.
- Host-visible Unix socket and lock paths are owned by the Node host. It applies
  resolved permissions before accepting clients and removes only paths owned by
  the attachment. Empty and numeric Unix group values are supported; named
  host-group lookup is rejected explicitly rather than guessed by Wasm.
- The PostgreSQL fork change is limited to a fenced call through PGlite libc
  for resolved Unix policy and to suppressing duplicate virtual-filesystem
  socket/lock creation. The callback is appended to the existing socket-host
  ABI so the classic non-SAB runtime and callback ordering remain unchanged.
- A fresh native ARM64 Wasm build passes deterministic artifact audits, nine
  postmaster integration tests, strict TCP bind-failure and native-client tests,
  strict Unix permission/lock/cleanup tests, concurrent native clients, separate
  TCP `host` and Unix `local` HBA password rejection and acceptance, libpq
  cancel/COPY/backpressure, and a targeted upstream regression schedule.
  Core/server TypeScript, lint, build, and ESM/CommonJS packed-export gates
  pass.

### Phase 4: establish tool-runner APIs

- Implement the native-style tool-runner contract for argv, environment,
  streaming standard I/O, cancellation, and exit status.
- Generalize the core initializer behind `_internal/initdb-runtime`.
- Expose the public Node `initdb()` TypeScript API from
  `@electric-sql/pglite-tools/initdb` with native defaults.
- Map host data directories into the standalone bootstrap runtime and write the
  cluster manifest atomically after success.
- Add `pg_isready` support.
- Preserve the existing high-level `pgDump({ pg })` API while adding a separate
  socket/libpq-oriented native runner.
- Establish artifact metadata and exact compatibility checks.

Exit criterion: server, standalone `initdb`, readiness, and dump behavior are
callable without the umbrella CLI; the native runners pass argv/stream/exit-code
contract tests and an initialized cluster boots under the released core
postmaster and Node server host.

Phase 4 implementation record, 2026-07-15:

- Core now owns a versioned `_internal/initdb-runtime` Worker host. It maps the
  caller's Node data directory through NODEFS, preserves native initdb argv and
  defaults, streams all three standard streams with backpressure, returns the
  native status, terminates on abort, and holds the authoritative cluster lease
  from before initialization through manifest persistence.
- `@electric-sql/pglite-tools/initdb` exposes the public initializer and checks
  its exact core peer and initdb-runtime ABI. Core and the tools package also
  publish generated, content-derived runtime identities; copied or mismatched
  native tool Wasm is rejected before a Worker starts. The server performs the
  corresponding exact peer and node-network-host ABI check.
- Classic and postmaster startup validate native `PG_VERSION` and `pg_control`
  identity followed by the atomic `.pglite/cluster.json` manifest before a
  backend Worker may mutate the cluster. A standalone initialized cluster boots
  sequentially under classic PGlite and the multi-session postmaster; a tampered
  catalog manifest is rejected before `postmaster.pid` exists.
- `pg_isready` and a socket/libpq-oriented native `pg_dump` runner use isolated
  Workers, the PGlite libc socket host, Node TCP or Unix sockets, PostgreSQL
  environment and service files, host working-directory output, streaming I/O,
  native diagnostics and statuses, and status 130 cancellation. The existing
  high-level `pgDump({ pg })` API and root export remain unchanged.
- The canonical Docker-contained Wasm wrapper completes from clean configure
  through build, artifact copying, extension copying, and metadata generation
  in the native `linux/arm64` tools image. The produced standalone artifacts are
  410,380 bytes for initdb Wasm, 327,661 for pg_isready, and 715,160 for pg_dump
  (146,778, 126,303, and 267,002 bytes gzip respectively).
- Seven real-runtime integration cases pass against wrapper-produced artifacts,
  including native defaults, failure cleanup, initdb and client cancellation,
  compatibility rejection, service-file lookup, readiness, and a host-file
  dump containing live data. Tool and server contract tests, TypeScript, lint,
  formatting, builds, and ESM/CommonJS export audits pass. The classic core
  suite passes serially with 306 tests and one existing skip; Node filesystem
  runtime tests pass 10/10. Fresh npm-packed core, server, and tools tarballs run
  initdb, classic reopen/query, server/postmaster imports, and pg_isready from
  both ESM and CommonJS installs.

### Phase 5: create `packages/pglite-cli`

- Publish it locally as `pglite`.
- Add the executable and top-level dispatcher.
- Implement `help`, `version`, `initdb`, `server`, `postgres`, and
  `pg_isready`, preserving the distinct `server` and `postgres` contracts.
- Add explicit root, postmaster, server, and tools re-exports.
- Implement foreground signals, exit codes, and diagnostics.
- Add packed-tarball integration tests.

Exit criterion: a clean Node project can use both `npx pglite` and
`import { PGlite } from 'pglite'`.

Phase 5 implementation record, 2026-07-15:

- The unscoped `pglite@0.5.4` package now provides one Node 22 executable and
  explicit root, postmaster, server, and tools entry points. Its packed
  manifest resolves the tested core `0.5.4`, server `0.1.0`, and tools `0.4.4`
  releases exactly; core, server, and the umbrella package are in the fixed
  release group that will align their versions when published.
- The dispatcher implements `help`, `version`, `initdb`, `server`, `postgres`,
  and `pg_isready`. Native argument vectors remain intact after the command
  boundary, while only documented PGlite hosting controls and the host `-D`
  mapping are consumed. Neither server mode initializes implicitly.
- `server` retains an explicit loopback-oriented PGlite listener contract;
  `postgres` uses PostgreSQL-controlled listeners and configuration. Foreground
  `SIGTERM`, `SIGINT`, and `SIGQUIT` map to smart, fast, and immediate shutdown,
  and `SIGHUP` delegates through the public server/postmaster reload API.
- A clean Docker-contained Node 22 test packs all four constituent packages,
  installs them with npm, and also runs the umbrella tarball through
  `npx --yes --package=... pglite`. Packed ESM and CommonJS imports exit without
  side effects and retain public class identity. The packaged CLI initializes a
  persistent cluster, serves two concurrent native `psql` clients, remains live
  across configuration reload, exits cleanly after `SIGTERM`, and removes
  `postmaster.pid`.
- The native `linux/arm64` integration gate also exposed and fixed an
  unconditional `pg_isready.wasm` install in the PostgreSQL fork; the artifact
  is now fenced to Emscripten builds and the exact-revision native tools build
  passes again.
- Packed sizes are 66,904,203 bytes raw/21,975,580 bytes compressed for core,
  125,300/32,877 for server, 3,493,433/1,131,025 for tools, and
  73,400/20,726 for the umbrella package. No Wasm file is duplicated across
  core and tools. The classic and postmaster preload data files have distinct
  content hashes, so the current package does not contain a byte-identical data
  payload that can be removed mechanically.
- Node 22 passes 15 server tests, 15 tools tests with seven Docker integration
  cases gated separately, and 12 CLI unit/export tests. TypeScript, lint,
  formatting, builds, export-shape checks, the native tool build, and the packed
  runtime scenario pass.

### Phase 6: PostgreSQL regression integration

- Drive the socket server through the packaged CLI.
- Implement the Docker-contained `pg_regress` lifecycle adapter.
- Run representative adapted `make check` schedules.
- Run adapted `make check-world` and classify unsupported tests explicitly.
- Preserve result artifacts and make failures reproducible.

Exit criterion: the CLI is a supported frontend for upstream regression runs.

Phase 6 implementation record, 2026-07-15:

- The exact packed `pglite` distribution now drives PostgreSQL's temporary
  clusters through Docker-contained `initdb`, `postgres`, and `pg_ctl`
  adapters. The provider preserves native client argument vectors, translates
  smart, fast, immediate, restart, status, and reload lifecycle operations,
  and records every cluster result against the exact PostgreSQL revision.
- Standalone initialization accepts the same configured full ICU archive as
  postmaster startup. This restores the standard ICU collation inventory for
  packed CLI clusters without embedding test-only policy in the public tool.
- PostgreSQL listener accepts are nonblocking across multiple effective
  listeners, preventing an empty listener from trapping the postmaster main
  loop after another listener claims a pending connection. Server-owned
  shutdown also drains listeners concurrently with postmaster shutdown while
  preserving caller-owned lifecycle semantics.
- Native ARM64 Docker `make check` passes all 230 core regression tests at
  PostgreSQL revision `4e8a8d2c9a`. The
  adapted `make -j2 -k check-world` records 226 passing supported suite/TAP
  events, 11 explicitly unsupported events, 26 blocked events, no supported
  failures, and 188 passing temporary-cluster lifecycles with no failed
  clusters. The upstream make exits zero.
- The capability policy defaults to supported and is revision-fenced. Narrow
  exact or prefix rules document absent build features separately from work
  that remains blocked; the summary fails on a supported failure, lifecycle
  failure, stale revision, target mismatch, or non-zero upstream exit.
- Complete logs, machine-readable summaries, per-cluster records, individual
  capability events, the packed provider, and the exact native build tree are
  retained with a canonical replay command. `tests/postgres/README.md`
  documents the Docker-only workflow and the evidence required before adding
  a capability rule.

### Phase 7: expand the command suite

- Add `psql`, `pg_dump`, and `pg_restore` based on usefulness and artifact cost.
- Add database and role administration commands where their underlying programs
  work correctly.
- Publish an explicit compatibility table.
- Reassess a limited `pg_ctl` only after foreground lifecycle is stable.

Exit criterion: each advertised command has packaged integration tests and
documented differences from native PostgreSQL.

Phase 7 implementation record, 2026-07-15:

- `@electric-sql/pglite-tools` now publishes isolated native-style runners for
  `psql`, `pg_restore`, `createdb`, `createuser`, `dropdb`, `dropuser`,
  `clusterdb`, `vacuumdb`, and `reindexdb` in addition to the existing
  `pg_dump` and `pg_isready` runners. The umbrella `pglite/tools` entry point
  re-exports the same runner and convenience-function identities; the CLI
  dispatches every command through one revision-identified internal registry.
- All client programs use the shared Worker, stream, filesystem, cancellation,
  libpq socket-host, and artifact-identity runtime. A nonblocking receive with
  no buffered socket data reports `EAGAIN`, matching libpq's poll contract
  instead of trapping psql after `ReadyForQuery`. The only additional
  PostgreSQL-fork changes are Emscripten-fenced Makefile definitions selecting
  PostgreSQL's existing private frontend encoding symbols for static linkage.
- A fresh packed installation runs every advertised command against one live
  multi-session server. It exercises concurrent native clients, Wasm psql SQL,
  variables, meta-commands, streamed `COPY FROM STDIN`, database and role
  creation/removal, maintenance commands, and table removal; plain, custom,
  tar, and directory-format dumps; archive listing; custom
  archive restore; and restored-row verification. The packed umbrella tarball
  also runs `initdb` and a queryable foreground `postgres` through a clean
  `npx --package` installation. Clean ESM and CommonJS
  imports prove identity for core, postmaster, server, all new scoped tool
  entry points, and the umbrella tools re-exports.
- The explicit compatibility table records the missing SSL, GSS, LDAP,
  readline, host-process, and parallel dump/restore facilities and the mounted
  host-path boundary. `pg_ctl` remains regression-provider infrastructure, not
  an advertised command: the foreground CLI already has tested signal and
  lifecycle semantics, while a partial native-shaped `pg_ctl` would add a
  second lifecycle contract without providing daemon mode.
- The nine Phase 7 JS/Wasm artifact pairs add 4,939,651 bytes raw and 1,735,821
  bytes when each file is gzipped. The final tools tarball is 8,633,040 bytes
  unpacked and 2,916,833 bytes compressed, increases of 5,139,607 and 1,785,808
  bytes over the Phase 5 package measurement. The umbrella tarball is 91,614
  bytes unpacked and 26,257 bytes compressed, increases of 18,214 and 5,531
  bytes.
- Node 22 passes 16 focused tools tests with seven Docker runtime cases gated
  separately and 24 CLI tests. Both packages pass TypeScript, lint, formatting,
  builds, and ESM/CommonJS export audits. The native ARM64 packed-package gate
  passes from artifact build through clean installation, programmatic imports,
  all command integrations, signal shutdown, and cluster cleanup.

Final implementation audit, 2026-07-15:

- Every in-repository acceptance criterion in Section 19 is implemented and
  passes its documented Node 22 / native ARM64 Docker gate. The final
  exact-revision PostgreSQL evidence is 230/230 for `make check`; for
  `make check-world`, 226 supported events pass, 11 are explicitly unsupported,
  26 are explicitly blocked, all 188 temporary-cluster lifecycles pass, and
  upstream make exits zero.
- The sole remaining release gate is the external Phase 0 action: an
  authenticated project owner must reserve the currently available `pglite`
  and `@electric-sql/pglite-server` npm names. No implementation work depends on
  that action, but the packages must not be published until it is complete.

## 17. Alternatives considered

### 17.1 Move the multi-session postmaster into `@electric-sql/pglite-server`

This gives the initial Node implementation one obvious home, but makes a
network-host package own an embedded API that does not require sockets. It would
also force the planned browser implementation either to depend on a Node-branded
server package or to move the public API and runtime a second time. Rejected in
favor of keeping `PGlitePostmaster`, sessions, process control, VFS integration,
and artifacts in core while the server composes them.

### 17.2 Put the Node server and CLI in `@electric-sql/pglite`

This provides one scoped package but increases its Node-specific responsibilities
and artifact footprint. It makes browser users carry distribution concerns they
did not request. Rejected in favor of a batteries-included umbrella package.

### 17.3 Make `pglite` CLI-only

This is mechanically simple, but users installing the canonical unscoped brand
will reasonably try `import { PGlite } from 'pglite'`. Re-exporting stable APIs
costs little and makes the package a coherent Node distribution. Rejected.

### 17.4 Continue replacing `@electric-sql/pglite-socket`

This treats a multi-session PostgreSQL server as an implementation update to a
socket adapter and breaks the package's historical semantics. The rewritten
branch version is unpublished, so this is rejected in favor of moving it.

### 17.5 Put every tool artifact in `pglite`

This would make the package self-contained at the file level but duplicate
ownership and complicate programmatic reuse. Depending on the tools package
still produces a self-contained installation while keeping implementation and
artifact ownership clear. Rejected.

### 17.6 Publish native PostgreSQL executable names

Publishing `postgres`, `psql`, and `initdb` bins is closer to native invocation
but risks shadowing system tools in npm-managed PATHs. The subcommand interface
is safer and clearer. Deferred unless a separate opt-in compatibility package
is justified.

## 18. Resolved implementation questions

1. The first command set is `initdb`, `postgres`, `server`, `pg_isready`,
   `psql`, `pg_dump`, `pg_restore`, `createdb`, `createuser`, `dropdb`,
   `dropuser`, `clusterdb`, `vacuumdb`, and `reindexdb`. Phase 7 records the
   artifact cost; `pg_ctl` remains test-provider infrastructure.
2. Wasm utilities preserve argument meanings, environment, streams,
   cancellation, and status through their native entry points. The published
   compatibility table identifies unavailable native terminal, process,
   security-library, locale-data, filesystem, and parallel-operation features.
3. CommonJS remains supported for every new public package subpath and is part
   of the packed-package and export-audit gates.
4. Trusted Node-only VFS and worker-factory configuration uses the documented
   `PGLITE_CONFIG` JavaScript module. The CLI accepts only the enumerated
   pluggable runtime fields; it does not move the VFS API into the distribution
   package.
5. `pglite --version` reports the distribution version followed by the exact
   PostgreSQL version embedded in the postmaster runtime identity.
6. Native PostgreSQL data-directory adoption is deferred. The initial release
   rejects a missing PGlite manifest before mutation; explicit, recoverable
   adoption belongs with future upgrade tooling.

## 19. Acceptance criteria

This design is complete when:

- the unscoped `pglite` package can be installed and run in a clean Node 22
  project;
- `npx pglite initdb` initializes a usable persistent cluster;
- `initdb()` from `@electric-sql/pglite-tools/initdb` initializes the same
  cluster using the same native defaults and streaming execution path;
- `npx pglite postgres` starts the Worker-backed multi-session server;
- independent native PostgreSQL clients can connect concurrently;
- `PGlitePostmaster.create()` is exported from
  `@electric-sql/pglite/postmaster` and each created session exposes the normal
  `PGliteInterface` without requiring the server package;
- CLI signals cause an orderly shutdown with no orphaned Workers or owned
  socket paths;
- `postgres` listener addresses, ports, Unix socket directories, and reloads
  follow effective PostgreSQL configuration rather than a duplicate CLI parser;
- `import { PGlite } from 'pglite'` has the same class and type identity as the
  scoped core export;
- `import { PGlitePostmaster } from 'pglite/postmaster'` has the same class and
  type identity as the scoped core postmaster export;
- `import { PGliteServer } from 'pglite/server'` exposes the scoped server API;
- the scoped core package remains compatible with its existing browser API,
  does not acquire server or tools artifacts, and does not load postmaster
  artifacts from its root export;
- the server owns no postmaster Wasm, Worker, memory, process-control, or VFS
  implementation and composes either a caller-owned or server-owned core
  postmaster with the specified lifecycle semantics;
- the server uses the public postmaster API plus, only if Phase 0 proves it
  necessary, the narrow Node network-host contract; tools use only their
  declared initdb/runtime contracts, and both fail clearly on ABI mismatch;
- the classic `pglite-socket` API remains available on its documented release
  line;
- native-style tool runners preserve argv, PostgreSQL environment variables,
  streaming standard I/O, cancellation, and exit status;
- public CLI commands do not inject non-native authentication or tool defaults;
- compatible clusters can be used sequentially by classic and postmaster runtimes,
  while concurrent or incompatible ownership is rejected before mutation;
- packed-package integration tests cover core, postmaster, server, and umbrella
  commands, imports, artifact resolution, lifecycle ownership, and exit behavior;
- at least the supported portion of PostgreSQL `make check` can run through the
  documented lifecycle adapter and packaged CLI server;
- package sizes and intentional PostgreSQL compatibility differences are
  published and tested;
- no phase in this plan claims or gates on a browser multi-session
  implementation; the browser-compatible source and export seams remain intact
  for the separate browser plan.
