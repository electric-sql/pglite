# @electric-sql/pglite

## 0.5.14

### Patch Changes

- 1cf7e86: Only build the `pglite.wasm`, `initdb.wasm` and `pglite.data` URLs when PGlite has to load them. Passing `pgliteWasmModule`, `initdbWasmModule` and `fsBundle` now works in bundles where `import.meta.url` is undefined, such as an esbuild IIFE build.
- 48dd3fb: Use PROXYFS instead of dumping the data dir from the scratch PGlite used for initdb when the data dir is in memory.
- 268929b: do not copy parsers on each query

## 0.5.13

### Patch Changes

- c7dc39e: `close()` now waits for queries, execs and transactions that were issued before it, so they complete instead of failing with `Cannot read properties of undefined` after teardown.
- 8364675: Added support for node-postgres through createPgConfig()
- a4cfd4d: Added MemfsFrontendFS which allows other filesystems be implemented on top of a MEMFS. Example: added Memfs2OpfsFS which is backed by an OPFS fs.
- 2db5d2d: Upgrade emsdk to 6.0.5

## 0.5.12

### Patch Changes

- 0641b37: Fix custom filesystems not receiving times set with `FS.utime`. Emscripten's `FS.utime` calls `setattr` with `atime` and `mtime`, but the `BaseFilesystem` bridge only handled the older `timestamp` field, so `utimes` was never called on OPFS AHP or any other `BaseFilesystem`. Files restored from a tarball kept the time they were written instead of the time stored in the tarball.
- e752dbe: Run initdb with `TZ=UTC`, like the backend, so a new database gets `timezone = 'UTC'` in `postgresql.conf`. Before, initdb wrote the host's zone as a fixed offset without daylight saving (e.g. `Etc/GMT+5` for America/New_York), so `timestamptz` input without an offset was stored at a different instant on each non-UTC machine.
- c31130c: Start under the Node.js permission model (`node --permission`). Emscripten's NODEFS read the fs open flags with `process.binding('constants')`, which Node always denies in that mode, so `new PGlite()` threw `ERR_ACCESS_DENIED` even for `memory://`. The bundled build now reads them from `require('fs').constants`, which holds the same values.
- 0641b37: Fix files restored from a tarball getting a January 1970 modification time. `loadTar` passed the tar header's time to Emscripten's `FS.utime` in seconds, but `FS.utime` takes milliseconds. This affected every new database (initdb's data dir is restored from a tarball) and every `loadDataDir`. With the Node filesystem the files on disk got those dates too.

## 0.5.11

### Patch Changes

- 5573bb0: bug fix: check ready before close
- 2372f39: Update submodule
- 4321a41: Fix premature ReadyForQuery responses after extended-query errors, preventing PostgreSQL clients from desynchronizing before Sync.

## 0.5.10

### Patch Changes

- 367ee2f: Bug fix: wait for running queries to finish before doing a data dir dump
- cb06c21: Wait for queries to finish before closing PGlite instance. See #1128
- 78012ca: Fix a windowed `live.query` (one given `offset` and `limit`) leaking its `live_query_<id>_get_total_count` prepared statement on `unsubscribe`. Only `live_query_<id>_get` was deallocated, so the count statement survived every teardown while its backing view was dropped, accumulating dangling prepared statements for the lifetime of the database.

## 0.5.9

### Patch Changes

- 389b731: upgrade to PostgreSQL 18.6
- 389b731: Export additional core symbols from the main WASM module required by the plpgsql_check extension

## 0.5.8

### Patch Changes

- c771db3: Do not set process.exitCode at all

## 0.5.7

### Patch Changes

- 2f9cf75: Fix convert_to

## 0.5.6

### Patch Changes

- 69b7d87: Apply the second options argument when calling `PGlite.create(undefined, options)`.
- 6c14380: fixes for process.exitCode

## 0.5.5

### Patch Changes

- a290741: Reset retained protocol parser state after a malformed backend message so later queries can recover.
- 6b6f28d: Fix `PGlite.create({ fs })` on a fresh database calling the provided filesystem's `init()` twice: the inner initdb instance no longer inherits the user-provided `fs` and always runs on its own scratch filesystem. Previously any VFS holding exclusive resources (e.g. OPFS sync access handles) failed with a contention error on first create.
- 354f4ae: Fix `formatQuery` (used by `live.query`/`live.incrementalQuery` to inline parameters) emitting `%NL` instead of the positional `%N$L` format specifier. A bare `%NL` is "min width N" and consumes `format()` arguments sequentially, so placeholders that are out of textual order silently bound the wrong values, and repeated placeholders failed with `too few arguments for format()`.
- 219af1e: Expose the fields node-postgres derives from the CommandComplete command tag on `Results`: `command` (e.g. `SELECT`, `INSERT`, `CREATE`), and `rowCount` (the per-statement count from the tag). The tag was already received and parsed internally to compute `affectedRows`, but these values were not surfaced. Matching node-postgres' `command`/`rowCount` result fields lets pg-compatible adapters report them without re-parsing SQL.
- 20839a7: Preserve the host `process.exitCode` when closing a PGlite instance. `close()` calls `_emscripten_force_exit(0)`, whose Emscripten runtime sets `process.exitCode = 0`, clobbering any exit code the host process had already set. This mirrors the existing save/restore guards in `#init()` and `execProtocolRaw()`, so closing a database no longer silently resets the host process's exit code.
- 7e784a4: Reject operations performed through transaction handles after the transaction has closed.

## 0.5.4

### Patch Changes

- 7e0d6d1: Detect the Node environment via `process.type` instead of `process.versions.electron`. The previous Electron guard (#951) also treated the Electron main and utility processes as non-Node, which broke PGlite's filesystem code path there. `process.type` only excludes Electron's web contexts (renderer, web worker, service worker), so PGlite keeps using the Node.js path in the Electron main and utility processes. Follow-up to #951 / #813.

## 0.5.3

### Patch Changes

- 2ccbb4c: Improve parsing/raw results handling

## 0.5.2

### Patch Changes

- 21fc995: fix serializing arrays of BigInts
- 0720cb6: Alow serializing untyped parameters
- e09535f: add pg_stat_statements.tar.gz to main package
- a4e163a: fix process exit code set/restore

## 0.5.1

### Patch Changes

- 930e2d0: fix PGlite version; redeploy external extensions

## 0.5.0

### Minor Changes

- 93d50aa: Upgrade to Postgres 18.3; move other extensions to their own npm packages;

## 0.4.6

### Patch Changes

- 2aa4d1a: Allow parsing of nulls in arrays #997
- 2095d4e: Add ICU support.
- e937669: Restore process.exitCode
- 54ed6dc: new API method copyToFs() and new param postgresqlconf
- 817d073: restore exit code

## 0.4.5

### Patch Changes

- c6bddde: Fix caching of artifacts such that they are not downloaded multiple times

## 0.4.4

### Patch Changes

- b88c5c3: Disable checkpointer

## 0.4.3

### Patch Changes

- 2ae666f: Default database, user and role are now all "postgres"
- fb95e66: Allow setting initial memory size.
- 65fc101: Disable background workers.

## 0.4.2

### Patch Changes

- 41632c4: Allow passing initdb.wasm asset for bundlers that need it.

## 0.4.1

### Patch Changes

- 37fb39e: clear timers on exit; remove pglite-socket dependency on pglite-postgis

## 0.4.0

### Minor Changes

- d848955: New simplified PGlite with separate initdb.
  New included extension: pg_textsearch (experimental).
  New package for postgis (experimental) as extension.
  Breaking changes: 'postgres' is the default database instead of 'template1'.

## 0.3.16

### Patch Changes

- 3dfa40f: Add Apache AGE graph database extension support

## 0.3.15

### Patch Changes

- 45bff97: added pgcrypto extension
- 5ec474f: Added pg_hashids extension.

## 0.3.14

### Patch Changes

- 8785034: Added pg_uuidv7 extension.
- 90cfee8: live extension: use schema.oid + table.oid in trigger identifiers

## 0.3.13

### Patch Changes

- ad3d0d8: Updated pg_dump to use callback data exchange; built pg_dump with emscripten

## 0.3.12

### Patch Changes

- ce0e74e: Added pgTAP extension.

## 0.3.11

### Patch Changes

- 9a104b9: Added dict_int, dict_xsyn, file_fdw, intarray, pageinspect, pg_buffercache, pg_freespacemap, pg_surgery, pg_visibility, pg_walinspect, unaccent contrib extensions

## 0.3.10

### Patch Changes

- ad765ed: initdb calls system to query the server configs. avoid that by hardcoding a return value of 123

## 0.3.9

### Patch Changes

- e40ccad: Upgrade emsdk

## 0.3.8

### Patch Changes

- f12a582: Ensure MessageContext and its children are actually cleared between queries

## 0.3.7

### Patch Changes

- 0936962: nested exception bugfix; wasm runtime exception fix

## 0.3.6

### Patch Changes

- 6898469: PostgreSQL 17.5
- 469be18: bug fix in packaging the distribution
- 64e33c7: bug fixes

## 0.3.5

### Patch Changes

- 6653899: fix: pglite worker dumpDataDir not using compression parameter
- 5f007fc: fix MERGE affected rows return count

## 0.3.4

### Patch Changes

- 1fcaa3e: fix race condition in live query unsubscribe
- 38a55d0: fix cjs/esm misconfigurations
- aac7003: remove double wasm instantiation when providing a wasm module'
- 8ca254d: expose listen function in transaction object

## 0.3.3

### Patch Changes

- ea2c7c7: pg_ivm extension

## 0.3.2

### Patch Changes

- e2c654b: automatic fallback from `cma` data transfer container to `file` for large queries, and fix errors that could result in a "memory access out of bounds" error.

## 0.3.1

### Patch Changes

- 713364e: Fix a bug in the live plugin that could result in an error when unsubscribing from a live query

## 0.3.0

### Minor Changes

- 97e52f7: upgrade to postgresql 17.4

### Patch Changes

- 4356024: bug fix live plugin when dealing with case sensitive table names
- 0033bc7: Fix a race condition in live query unsubscription that could result in live queries failing to update.

## 0.2.17

### Patch Changes

- 6bdd74e: listen and unlisten case sensitivity behaviour aligned to default PostgreSQL behaviour'
- f94d591: added clone() method to pglite API. clones an instance such that it can be reused (for example running tests on existing data without readding all data)

## 0.2.16

### Patch Changes

- c36fd09: Improvements to parsing results received from pg
- e037883: Fixed PGliteWorkerOptions type
- d6b981b: Fix the return type of the `.transaction` method
- 17e7664: Export the base filesystem to enable creating custom file systems. NOTE: This is a work-in-progress API, it is not stable, and may change significantly in future!
- 118ba3e: Add affectedRows for COPY command
- d93c1bb: Add `refreshArrayTypes()` call to re-sync newly created complex array columns, like enums
- ddd4a68: Removes postgis extension which leads to a smaller build of the package
- f3f1103: Refactor the protocol message parse code to be simpler and easer to follow
- 67fb2aa: feat: add support for loading compressed dumps via loadDataDir that are not labeled with mimetype

## 0.2.15

### Patch Changes

- fa13714: Remove a debug console.log from the live query plugin

## 0.2.14

### Patch Changes

- 6547374: New `runExclusive` method on PGlite that allows you to hold an exclusive lock on the database, for use with `execProtocol*` methods
- 6547374: A new `execProtocolRawSync` method that can execute a postgres wire protocol synchronously
- df5c290: Make pglite compatible with @jest-environment: node
- 1784d04: Bump Emscripten to 3.1.72
- ae36974: Fix a bug with pipelining prepared statements.
- 75f9f6d: Add a `offset` and `limit` option to live queries, when used it will return the total count for the query along with efficient updating of the offset. This works well with windowed or virtualised scrolling components.
- ce212cf: Use PG "WITH RECURSIVE" to traverse the live query dependencies

## 0.2.13

### Patch Changes

- 5e39036: Fix live queries can query a view by recursively finding all tables they depend on.
- 3d8efbb: Bump dependencies to address Dependabot alerts
- 1844b10: Add a new `describeQuery` method to get type information about a query's parameters and result fields without executing it.
- 79e6082: Changed PGlite interface to automatically add typing for extensions.
- 16d2296: Fix bug where Firefox was unable to remove OPFS files
- cf50f47: Change interface of execProtocol return value to remove duplication of data buffer
- bd1b3b9: Fix a bug in live.incrementalQuery where if it was set to `limit 1` it would return no rows
- 5e39036: Extend the return value of live queries to be subscribed to multiple times, and make the callback optional on initiation.
- 16d2296: Fix an issue with live.incrementalQuery where the order would be incorrect with rapid consecutive queries
- e9bd9a7: Fix the types exports spesified in package.json
- c442c88: Added custom parser and serializer options to `PGliteOptions`. Added custom serializer option to `QueryOptions`.

## 0.2.12

### Patch Changes

- 1495625: add `util` to package.json browser config to exclude it in browser builds
- d3905cf: Export LiveNamespace type from the live extension
- 1f036dc: The VFS API has been refactored, along with the OPFS implementation, in order to prepare it for becoming a public API.
- 52ddcb0: Fix issue where a string passed as a parameter expecting JSON would not treat the string as a json encoded string

## 0.2.11

### Patch Changes

- 2aed553: Bump Emscripten to 3.1.68. Fixes issue #328 where some bundlers would fail to build with a "Failed to resolve './' from './node_modules/@electric-sql/pglite/dist/postgres.js'" error.

## 0.2.10

### Patch Changes

- 3113d56: Add `fs/promises: false` to the browser config in package.json to exclude it from browser builds.
- 23cd31a: Improve type serialization so it matches exceptions from other libraries

## 0.2.9

### Patch Changes

- 20008c2: Fix an issue where extensions where given an oid in the builtin range and so skipped by pg_dump when run via pg_gateway #352
- a5712a8: Fix a bug where Postgres would hang after a "DROP DATABASE" followed by an unclean shutdown and restart

## 0.2.8

### Patch Changes

- 53ec60e: Fix the sql tagged template method to correctly handle null values
- 880b60d: Fix close() as it was not correctly shutting down Postgres
- 058ed7c: Fix quoting of table and channel names with the live plugin and listen method. Fixes issue where the live plugin would not work when the table names were camel case.
- 2831c34: Add wasmModule and fsBundle options to manually load the WASM module and FS bundle. Additionally cache the WASM module and FS bundle after the first download for a speedup on subsequent calls.
- 880b60d: Fix DROP DATABASE so that it doesn't hang in a busy loop
- 880b60d: Initial work towards a WASI build of PGlite
- 4aeb677: Change parameter serialization to be driven by expected types from Postgres, rather than inferring from the JS type
- 19b3529: Fix path alias for `@electric-sql/pg-protocol` to bundle types correctly

## 0.2.7

### Patch Changes

- 5e65236: Fix an issue where the protocol ready-for-query message was not returned after an error when using execProtocol.
- 5e65236: Remove a double forward slash in bundled extension paths.

## 0.2.6

### Patch Changes

- 09b356c: Fixed extended query wire protocol
- 4238595: Fix `incrementalQuery` and `changes` APIs not working when keyed on non-integer primary keys like `TEXT` and `UUID`.
- ef57e10: Refactor PGliteWorker so parsing happens on the main thread, fixes query options with custom parser

## 0.2.5

### Patch Changes

- fcb101c: Add `    tx.sql`` ` API to PGliteWorker transactions.
- 3ee5e60: Implement `.create(dataDir: string, options: PGliteOptions)` signature for factory method to match constructor.
- 0dc34af: Enable event triggers like `ddl_command_end`.

## 0.2.4

### Patch Changes

- 113aa56: Replace `pg-protocol` with vendored version and remove `Buffer` polyfill.

## 0.2.3

### Patch Changes

- d8ef285: Implement `sql` tagged template literal method for querying, along with helpers.

## 0.2.2

### Patch Changes

- be41880: Fix linking bug that prevented full text search working correctly

## 0.2.1

### Patch Changes

- 2cc39ff: New compression options for the `dumpDataDir` method and fix a bug that prevented compression when used in a worker.
