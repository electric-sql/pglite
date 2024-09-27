# @electric-sql/pglite-sync

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
