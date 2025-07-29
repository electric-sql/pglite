# @electric-sql/pglite-sync

## 0.3.9

### Patch Changes

- Updated dependencies [6898469]
- Updated dependencies [469be18]
- Updated dependencies [64e33c7]
  - @electric-sql/pglite@0.3.6

## 0.3.8

### Patch Changes

- Updated dependencies [6653899]
- Updated dependencies [5f007fc]
  - @electric-sql/pglite@0.3.5

## 0.3.7

### Patch Changes

- 38a55d0: fix cjs/esm misconfigurations
- Updated dependencies [1fcaa3e]
- Updated dependencies [38a55d0]
- Updated dependencies [aac7003]
- Updated dependencies [8ca254d]
  - @electric-sql/pglite@0.3.4

## 0.3.6

### Patch Changes

- Updated dependencies [ea2c7c7]
  - @electric-sql/pglite@0.3.3

## 0.3.5

### Patch Changes

- 0655bff: batch inserts by by a max query size of 50mb

## 0.3.4

### Patch Changes

- Updated dependencies [e2c654b]
  - @electric-sql/pglite@0.3.2

## 0.3.3

### Patch Changes

- ad27e7c: Improve insert management for pglite-sync
- Updated dependencies [713364e]
  - @electric-sql/pglite@0.3.1

## 0.3.2

### Patch Changes

- 317fd36: Specify a peer dependency range on @electric-sql/pglite
- Updated dependencies [97e52f7]
- Updated dependencies [4356024]
- Updated dependencies [0033bc7]
  - @electric-sql/pglite@0.3.0

## 0.3.1

### Patch Changes

- 3ee6846: New `initialInsertMethod` option that can specify `insert`, `csv` or `json` as the method used to handle the initial sync. The supersedes the `useCopy` option which is now deprecated and will be removed in a future version.

## 0.3.0

### Minor Changes

- f50b5f8: Support for multi shape transactional sync via a new `syncShapesToTables` api. This ensures that all changes from Postgres that were part of the same transaction are applied together as a single transaction to the local PGlite database.

  Note: The `commitGranularity` and `commitThrottle` options have been removed due to incompatibility with the new transactional sync mechanism.

## 0.2.20

### Patch Changes

- c489ec0: Correctly persist the offset during initial sync

## 0.2.19

### Patch Changes

- 67bf759: shapeKey in syncShapeToTable is now mandatory but nullable; passing null will not persist the shape
- b3640ee: Update the sync plugin to work with the latest Electric sync server
- Updated dependencies [6bdd74e]
- Updated dependencies [f94d591]
  - @electric-sql/pglite@0.2.17

## 0.2.18

### Patch Changes

- Updated dependencies [c36fd09]
- Updated dependencies [e037883]
- Updated dependencies [d6b981b]
- Updated dependencies [17e7664]
- Updated dependencies [118ba3e]
- Updated dependencies [d93c1bb]
- Updated dependencies [ddd4a68]
- Updated dependencies [f3f1103]
- Updated dependencies [67fb2aa]
  - @electric-sql/pglite@0.2.16

## 0.2.17

### Patch Changes

- 46c102c: Add options for the `commitGranularity` parameter in the `syncShapeToTable` function, enabling the user to choose how often the sync should commit.
- c3d98d5: Export return type of `syncShapeToTable`
- 515a155: Bump the version of the Electric sync client
- Updated dependencies [fa13714]
  - @electric-sql/pglite@0.2.15

## 0.2.16

### Patch Changes

- d1dd12b: Bump the supported version of the ElectricSQL sync server to the latest version
- Updated dependencies [6547374]
- Updated dependencies [6547374]
- Updated dependencies [df5c290]
- Updated dependencies [1784d04]
- Updated dependencies [ae36974]
- Updated dependencies [75f9f6d]
- Updated dependencies [ce212cf]
  - @electric-sql/pglite@0.2.14

## 0.2.14

### Patch Changes

- f4f8a42: Filter out update messages that don't modify any columns
- 3d8efbb: Bump dependencies to address Dependabot alerts
- 1685b91: Set an `electric.syncing` config flag in Postgres during a sync transaction to enable user defined triggers to chose how to run during a sync.
- 61f638e: Change to do a `DELETE FROM` rather than a `TRUNCATE` on `must-refetch` so that custom merge logic can be applied with triggers.
- 61f638e: Add a `useCopy` option to `syncShapeToTable`, when `true` performs a `COPY TO` for the initial sync.
- Updated dependencies [5e39036]
- Updated dependencies [3d8efbb]
- Updated dependencies [1844b10]
- Updated dependencies [79e6082]
- Updated dependencies [16d2296]
- Updated dependencies [cf50f47]
- Updated dependencies [bd1b3b9]
- Updated dependencies [5e39036]
- Updated dependencies [16d2296]
- Updated dependencies [e9bd9a7]
- Updated dependencies [c442c88]
  - @electric-sql/pglite@0.2.13

## 0.2.13

### Patch Changes

- Updated dependencies [1495625]
- Updated dependencies [d3905cf]
- Updated dependencies [1f036dc]
- Updated dependencies [52ddcb0]
  - @electric-sql/pglite@0.2.12

## 0.2.12

### Patch Changes

- Updated dependencies [2aed553]
  - @electric-sql/pglite@0.2.11

## 0.2.11

### Patch Changes

- Updated dependencies [3113d56]
- Updated dependencies [23cd31a]
  - @electric-sql/pglite@0.2.10

## 0.2.10

### Patch Changes

- Updated dependencies [20008c2]
- Updated dependencies [a5712a8]
  - @electric-sql/pglite@0.2.9

## 0.2.9

### Patch Changes

- 95b41a1: Clear uncommitted aggregated messages upon receiving `must-refetch` message

## 0.2.8

### Patch Changes

- 821a7c5: Commit `ShapeStream` message batches transactionally.
  Implement `shapeKey` option to `syncShapeToTable` to persist stream.
  Implement `metadataSchema` option to `electricSync` configuration to specify where stream metadata is peristed.
  Implement in-memory lock to disallow multiple shapes on single table.
  Fix `must-refetch` handling by truncating underlying table on refetch.
  [BREAKING] Move `ShapeStreamOptions` as separate property of `SyncShapeToTableOptions` rather than extension
- 6e116c6: Implement naive resumability which truncates the synced table on restart.
- Updated dependencies [53ec60e]
- Updated dependencies [880b60d]
- Updated dependencies [058ed7c]
- Updated dependencies [2831c34]
- Updated dependencies [880b60d]
- Updated dependencies [880b60d]
- Updated dependencies [4aeb677]
- Updated dependencies [19b3529]
  - @electric-sql/pglite@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies [5e65236]
- Updated dependencies [5e65236]
  - @electric-sql/pglite@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [09b356c]
- Updated dependencies [4238595]
- Updated dependencies [ef57e10]
  - @electric-sql/pglite@0.2.6

## 0.2.5

### Patch Changes

- dd271b3: Fix #232 by making the options passed to the sync plugin optional
- 79b5a7b: Fix the pglite-sync package dependencies
- Updated dependencies [fcb101c]
- Updated dependencies [3ee5e60]
- Updated dependencies [0dc34af]
  - @electric-sql/pglite@0.2.5

## 0.2.4

### Patch Changes

- 76d1908: Fix typo in `unsubscribe` API (was previously `unsuscribe`).
- e9a2677: Change `action` header to `operation` to match the Electric API.
- Updated dependencies [113aa56]
  - @electric-sql/pglite@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [d8ef285]
  - @electric-sql/pglite@0.2.3

## 0.2.2

### Patch Changes

- b7917db: Fix pglite-sync package which incorrectly pointed to ./build not ./dist
- Updated dependencies [be41880]
  - @electric-sql/pglite@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [2cc39ff]
  - @electric-sql/pglite@0.2.1
