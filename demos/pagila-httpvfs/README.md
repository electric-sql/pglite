# PGlite + HttpFs Demo

This demo shows how to use PGlite, a WASM build of Postgres running entirely in the browser, with the WIP HttpFs to connect to a remote PGlite database. It's using HTTP range requests to fetch database file pages from the remote server on demand.

The database in this demo is the Pagila sample database.

## Development

Install the dependencies:

```
pnpm install
```

Build the database:

```
pnpm make-database
```

Start the dev server:

```
pnpm dev
```
