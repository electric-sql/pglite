# Benchmarks

There are two sets of benchmarks, one testing [round trip time](#round-trip-time-benchmarks) for both PGlite and wa-sqlite, and [another](#pglite-results-from-wa-sqlite-benchmark-suite) based on the [wa-sqlite bechmarks](https://rhashimoto.github.io/wa-sqlite/demo/benchmarks.html).

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
