# Benchmarks

There are two sets of benchmarks, one testing [round trip time](#round-trip-time-benchmarks) for both PGlite and wa-sqlite, and [another](#pglite-results-from-wa-sqlite-benchmark-suite) based on the [wa-sqlite benchmarks](https://rhashimoto.github.io/wa-sqlite/demo/benchmarks.html).

To run, from this dir:

```sh
pnpm install
pnpm build
cd ./dist
python3 -m http.server
```

Then open `http://localhost:8000/index.html` for the benchmarks based on the wa-sqlite set, and `http://localhost:8000/rtt.html` for the round trip time benchmarks.

There is also a script `baseline.ts` that generates a set of native baseline results for the wa-sqlite benchmark suite. This can be run with `npx tsx baseline.ts`.

There is a [writeup of the benchmarks in the docs](../../docs/benchmarks.md).

## Text result decoding in Node.js

After building PGlite, run this from the repository root:

```sh
node packages/benchmark/text-decoding.mjs 45056 500
```

The arguments are UTF-8 bytes per row and measured query count. Each query returns
200 text rows from a disposable file-backed database, after 20 warmup queries.
Use `512` for a smaller result. The script checks returned contents and removes
its database after closing it.

Compare identical commands in separate baseline and candidate checkouts. Process
CPU includes runtime background threads; elapsed time is reported separately.
There is no forced collection or heap limit. Short runs can vary substantially,
and these query results do not establish application throughput or capacity.
