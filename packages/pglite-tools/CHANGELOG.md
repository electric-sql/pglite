# @electric-sql/pglite-tools

## 0.2.16

### Patch Changes

- Updated dependencies [9a104b9]
  - @electric-sql/pglite@0.3.11

## 0.2.15

### Patch Changes

- Updated dependencies [ad765ed]
  - @electric-sql/pglite@0.3.10

## 0.2.14

### Patch Changes

- e40ccad: Upgrade emsdk
- Updated dependencies [e40ccad]
  - @electric-sql/pglite@0.3.9

## 0.2.13

### Patch Changes

- be677b4: fix pg_dump on Windows systems

  When calling **pg_dump** on Windows system the function fails with an error as the one bellow.
  ❗ Notice the double drive letter
  `Error: ENOENT: no such file or directory, open 'E:\C:\Users\<USERNAME>\AppData\Local\npm-cache\_npx\ba4f1959e38407b5\node_modules\@electric-sql\pglite-tools\dist\pg_dump.wasm'`

  The problem is in execPgDump function at line
  `const blob = await fs.readFile(bin.toString().slice(7))`
  I think the intention here was to remove `file://` from the begging of the path. However this is not necesarry readFile can handle URL objects.
  Moreover this will fail on Windows becase the slice creates a path like '/C:/<USERNAME>...' and the readFile function will add the extra drive letter

- Updated dependencies [f12a582]
- Updated dependencies [bd263aa]
  - @electric-sql/pglite@0.3.8

## 0.2.12

### Patch Changes

- Updated dependencies [0936962]
  - @electric-sql/pglite@0.3.7

## 0.2.11

### Patch Changes

- Updated dependencies [6898469]
- Updated dependencies [469be18]
- Updated dependencies [64e33c7]
  - @electric-sql/pglite@0.3.6

## 0.2.10

### Patch Changes

- 8172b72: new pg_dump wasm blob
- Updated dependencies [6653899]
- Updated dependencies [5f007fc]
  - @electric-sql/pglite@0.3.5

## 0.2.9

### Patch Changes

- 38a55d0: fix cjs/esm misconfigurations
- Updated dependencies [1fcaa3e]
- Updated dependencies [38a55d0]
- Updated dependencies [aac7003]
- Updated dependencies [8ca254d]
  - @electric-sql/pglite@0.3.4

## 0.2.8

### Patch Changes

- Updated dependencies [ea2c7c7]
  - @electric-sql/pglite@0.3.3

## 0.2.7

### Patch Changes

- Updated dependencies [e2c654b]
  - @electric-sql/pglite@0.3.2

## 0.2.6

### Patch Changes

- Updated dependencies [713364e]
  - @electric-sql/pglite@0.3.1

## 0.2.5

### Patch Changes

- 317fd36: Specify a peer dependency range on @electric-sql/pglite
- Updated dependencies [97e52f7]
- Updated dependencies [4356024]
- Updated dependencies [0033bc7]
  - @electric-sql/pglite@0.3.0

## 0.2.4

### Patch Changes

- bbfa9f1: Restore SEARCH_PATH after pg_dump

## 0.2.3

### Patch Changes

- 8545760: pg_dump error messages set on the thrown Error
- d26e658: Run a DEALLOCATE ALL after each pg_dump to cleanup the prepared statements.

## 0.2.2

### Patch Changes

- 17c9875: add node imports to the package.json browser excludes

## 0.2.1

### Patch Changes

- 6547374: Alpha version of pg_dump support in the browser and Node using a WASM build of pg_dump
