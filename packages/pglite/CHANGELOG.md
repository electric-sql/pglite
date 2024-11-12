# @electric-sql/pglite

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
