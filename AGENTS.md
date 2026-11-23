## Architecture boundries

PGlite has two main layers. Keep changes in the layer that owns the behavior; avoid duplicating logic across layers.

### PostgreSQL source (backend)

- **Location:** `postgres-pglite` as submodule.
- **Owns:** PostgreSQL engine changes, including changes needed by PGlite. Those specific changes are noted by the string `__PGLITE__`.
- **When to change this layer:** `bringing in changes in the upstream PostgreSQL source: https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary` or `changes to PGlite that require backend code changes.
- **Boundary:** Changes here may require rebuilding the WASM module and updating `[any related tests or generated artifacts]`.
- **Other:** This layer also contains PGlite specific files, mainly in the `./postgres-pglite/pglite` subfolder. 

### TypeScript packages

- **Package locations:** `packages`
- **Core package:** `packages/pglite` — owns `[public API, query interface, lifecycle, etc.]`.
- **Other packages:** `packages/pglite-extensions` contains all the ported extensions. `packages/pglite-socket` is a socket interface to PGlite that acts as a bridge between Postgres clients (such as `psql`) and PGlite. Since PGlite is currently single-connection, multiple clients are multiplexed over this single connection by this package.
- **Owns:** The JavaScript/TypeScript API, package integrations, persistence adapters, and other features implemented outside the PostgreSQL engine.
- **When to change this layer:** `[public API, Node/browser compatibility, package exports, adapters, new extensions, new functionality]`.
- **Boundary:** Keep PostgreSQL semantics in the PostgreSQL layer when possible; use TypeScript to expose or adapt behavior, not to reimplement the database engine.

### Extension development

Using PostgreSQL extensions directly with PGlite is possible after porting them. A porting primer exists in `docs/extensions/development.md`. As much as possible, porting an extension should not modify the core PGlite code or the PostgreSQL code used by PGlite.

