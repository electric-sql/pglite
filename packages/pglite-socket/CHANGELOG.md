# @electric-sql/pglite-socket

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
