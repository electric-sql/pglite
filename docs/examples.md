# Examples

We have a number of examples showing how to use PGlite along with its capabilities:

- <a href="./examples/basic.html" target="_blank">Basic</a><br>
  A basic example showing how to initiate a PGlite database and perform queries using `.exec()`

- <a href="./examples/query-params.html" target="_blank">Query Params</a><br>
  Aa example showing how to perform parametrised queries using `.query()` method.

- <a href="./examples/copy.html" target="_blank">Copy</a><br>
  An example showing to use the `COPY` command with the PGlite `/dev/blob` device.

- <a href="./examples/dump-data-dir.html" target="_blank">Dump Data Dir</a><br>
  Example of the `db.dumpDataDir()` method to save a tarball of a database.

- <a href="./examples/live.html" target="_blank">Live Query</a><br>
  Reactivity example using the live query extensions `.live.query()` method.

- <a href="./examples/live-changes.html" target="_blank">Live Changes</a><br>
  Reactivity example using the live query extensions `.live.changes()` method.

- <a href="./examples/live-incremental.html" target="_blank">Live Incremental Query</a><br>
  Reactivity example using the live query extensions `.live.incrementalQuery()` method.

- <a href="./examples/notify.html" target="_blank">Notify and Listen</a><br>
  Example showing the use of the `NOTIFY` and `LISTEN` Postgres commands via the PGlite `.listen()` API.

- <a href="./examples/opfs.html" target="_blank">OPFS VFS</a><br>
  An example demonstrating the [OPFS Access Handle Pool VFS](./docs/filesystems.md#opfs-ahp-fs).

- <a href="./examples/copy.html" target="_blank">PL/PGSQL</a><br>
  Demonstration of PGlite's support for Postgres's built-in SQL procedural language extension "PL/PGSQL".

- <a href="./examples/vector.html" target="_blank">Extension: `pgvector`</a><br>
  An example showing how to use [pgvector](https://github.com/pgvector/pgvector) with PGlite.

- <a href="./examples/worker.html" target="_blank">Multi Tab Worker</a><br>
  Demonstration of the multi tab worker, enabling multiple browser tabs to share a PGlite database.
