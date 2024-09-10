# @electric-sql/pglite

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
