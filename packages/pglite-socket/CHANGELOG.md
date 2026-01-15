# @electric-sql/pglite-socket

## 0.0.20

### Patch Changes

- 54a4873: allow extensions to be loaded via '-e/--extensions <list>' cmd line parameter'
- 45bff97: added pgcrypto extension
- Updated dependencies [45bff97]
- Updated dependencies [5ec474f]
  - @electric-sql/pglite@0.3.15

## 0.0.19

### Patch Changes

- Updated dependencies [8785034]
- Updated dependencies [90cfee8]
  - @electric-sql/pglite@0.3.14

## 0.0.18

### Patch Changes

- Updated dependencies [ad3d0d8]
  - @electric-sql/pglite@0.3.13

## 0.0.17

### Patch Changes

- Updated dependencies [ce0e74e]
  - @electric-sql/pglite@0.3.12

## 0.0.16

### Patch Changes

- Updated dependencies [9a104b9]
  - @electric-sql/pglite@0.3.11

## 0.0.15

### Patch Changes

- Updated dependencies [ad765ed]
  - @electric-sql/pglite@0.3.10

## 0.0.14

### Patch Changes

- e40ccad: Upgrade emsdk
- Updated dependencies [e40ccad]
  - @electric-sql/pglite@0.3.9

## 0.0.13

### Patch Changes

- bd263aa: fix oom; other fixes
- Updated dependencies [f12a582]
- Updated dependencies [bd263aa]
  - @electric-sql/pglite@0.3.8

## 0.0.12

### Patch Changes

- Updated dependencies [0936962]
  - @electric-sql/pglite@0.3.7

## 0.0.11

### Patch Changes

- Updated dependencies [6898469]
- Updated dependencies [469be18]
- Updated dependencies [64e33c7]
  - @electric-sql/pglite@0.3.6

## 0.0.10

### Patch Changes

- Updated dependencies [6653899]
- Updated dependencies [5f007fc]
  - @electric-sql/pglite@0.3.5

## 0.0.9

### Patch Changes

- 38a55d0: fix cjs/esm misconfigurations
- Updated dependencies [1fcaa3e]
- Updated dependencies [38a55d0]
- Updated dependencies [aac7003]
- Updated dependencies [8ca254d]
  - @electric-sql/pglite@0.3.4

## 0.0.8

### Patch Changes

- Updated dependencies [ea2c7c7]
  - @electric-sql/pglite@0.3.3

## 0.0.7

### Patch Changes

- 5a47f4d: better handling of closing the socket
- 6f8dd08: with the `npx pglite-server` command, add the ability to pass a command to run after the server is ready, along with passing a new DATABASE_URL environment variable to the command. This allows for a command like `npx pglite-server -r "npm run dev:inner" --include-database-url` to run a dev server that uses the pglite server as the database.

## 0.0.6

### Patch Changes

- Updated dependencies [e2c654b]
  - @electric-sql/pglite@0.3.2

## 0.0.5

### Patch Changes

- f975f77: Updated README
- d9b52d5: allows unix socket connections

## 0.0.4

### Patch Changes

- 027baed: missing shebang

## 0.0.3

### Patch Changes

- 1c2dc84: fix pglite-socket exports

## 0.0.2

### Patch Changes

- Updated dependencies [713364e]
  - @electric-sql/pglite@0.3.1
