# @electric-sql/pglite-socket

## 0.2.7

### Patch Changes

- Updated dependencies [7e0d6d1]
  - @electric-sql/pglite@0.5.4
  - @electric-sql/pglite-age@0.0.5
  - @electric-sql/pglite-pg_hashids@0.0.5
  - @electric-sql/pglite-pg_ivm@0.0.5
  - @electric-sql/pglite-pg_textsearch@0.0.6
  - @electric-sql/pglite-pg_uuidv7@0.0.5
  - @electric-sql/pglite-pgtap@0.0.5
  - @electric-sql/pglite-pgvector@0.0.5

## 0.2.6

### Patch Changes

- 29f5617: Handle PostgreSQL CancelRequest wire protocol messages

  Added support for the CancelRequest message that some clients and connection proxies send during the connection startup phase. PGlite has no backend process to cancel, so the request is consumed and silently ignored (the protocol expects no response), which prevents it from being misinterpreted as a malformed startup/typed message. This complements the existing SSLRequest handling.

## 0.2.5

### Patch Changes

- Updated dependencies [14ba7bf]
  - @electric-sql/pglite-pg_textsearch@0.0.5

## 0.2.4

### Patch Changes

- Updated dependencies [2ccbb4c]
  - @electric-sql/pglite@0.5.3
  - @electric-sql/pglite-age@0.0.4
  - @electric-sql/pglite-pg_hashids@0.0.4
  - @electric-sql/pglite-pg_ivm@0.0.4
  - @electric-sql/pglite-pg_textsearch@0.0.4
  - @electric-sql/pglite-pg_uuidv7@0.0.4
  - @electric-sql/pglite-pgtap@0.0.4
  - @electric-sql/pglite-pgvector@0.0.4

## 0.2.3

### Patch Changes

- 7f6ee05: Handle the `SSLRequest` startup packet per the PostgreSQL wire protocol: when SSL is not available, respond with `N` so the client may continue with a cleartext `StartupMessage`. Improves interoperability with JDBC clients such as DBeaver that probe TLS first without requiring manual SSL mode tweaks. See https://www.postgresql.org/docs/current/protocol-message-formats.html .

## 0.2.2

### Patch Changes

- Updated dependencies [21fc995]
- Updated dependencies [0720cb6]
- Updated dependencies [e09535f]
- Updated dependencies [a4e163a]
  - @electric-sql/pglite@0.5.2
  - @electric-sql/pglite-age@0.0.3
  - @electric-sql/pglite-pg_hashids@0.0.3
  - @electric-sql/pglite-pg_ivm@0.0.3
  - @electric-sql/pglite-pg_textsearch@0.0.3
  - @electric-sql/pglite-pg_uuidv7@0.0.3
  - @electric-sql/pglite-pgtap@0.0.3
  - @electric-sql/pglite-pgvector@0.0.3

## 0.2.1

### Patch Changes

- Updated dependencies [930e2d0]
  - @electric-sql/pglite@0.5.1
  - @electric-sql/pglite-age@0.0.2
  - @electric-sql/pglite-pg_hashids@0.0.2
  - @electric-sql/pglite-pg_ivm@0.0.2
  - @electric-sql/pglite-pg_textsearch@0.0.2
  - @electric-sql/pglite-pg_uuidv7@0.0.2
  - @electric-sql/pglite-pgtap@0.0.2
  - @electric-sql/pglite-pgvector@0.0.2

## 0.2.0

### Minor Changes

- 93d50aa: Upgrade to Postgres 18.3; move other extensions to their own npm packages;
- Updated dependencies [93d50aa]
- Updated dependencies [93d50aa]
  - @electric-sql/pglite@0.5.0
  - @electric-sql/pglite-age@0.0.1
  - @electric-sql/pglite-pg_hashids@0.0.1
  - @electric-sql/pglite-pg_ivm@0.0.1
  - @electric-sql/pglite-pg_textsearch@0.0.1
  - @electric-sql/pglite-pg_uuidv7@0.0.1
  - @electric-sql/pglite-pgtap@0.0.1
  - @electric-sql/pglite-pgvector@0.0.1

## 0.1.6

### Patch Changes

- 791fbc7: Fix `PGLiteSocketServer` `maxConnections` JSDoc default — the constructor defaults to `1` (matching the CLI default and help text); only the JSDoc claimed `100`.
- Updated dependencies [2aa4d1a]
- Updated dependencies [2095d4e]
- Updated dependencies [e937669]
- Updated dependencies [54ed6dc]
- Updated dependencies [817d073]
  - @electric-sql/pglite@0.4.6

## 0.1.5

### Patch Changes

- Updated dependencies [c6bddde]
  - @electric-sql/pglite@0.4.5

## 0.1.4

### Patch Changes

- Updated dependencies [b88c5c3]
  - @electric-sql/pglite@0.4.4

## 0.1.3

### Patch Changes

- Updated dependencies [2ae666f]
- Updated dependencies [fb95e66]
- Updated dependencies [65fc101]
  - @electric-sql/pglite@0.4.3

## 0.1.2

### Patch Changes

- Updated dependencies [41632c4]
  - @electric-sql/pglite@0.4.2

## 0.1.1

### Patch Changes

- Updated dependencies [37fb39e]
  - @electric-sql/pglite@0.4.1

## 0.1.0

### Minor Changes

- Updated dependencies [d848955]
  - @electric-sql/pglite-postgis@0.0.1
  - @electric-sql/pglite@0.4.0

## 0.0.22

### Patch Changes

- Updated dependencies [3dfa40f]
  - @electric-sql/pglite@0.3.16

## 0.0.21

### Patch Changes

- 8a03647: Fix: Message buffering, connection handling, and concurrent connection support;

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
