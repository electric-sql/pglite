---
'@electric-sql/pglite-socket': patch
---

with the `npx pglite-server` command, add the ability to pass a command to run after the server is ready, along with passing a new DATABASE_URL environment variable to the command. This allows for a command like `npx pglite-server -r "npm run dev:inner" --include-database-url` to run a dev server that uses the pglite server as the database.
