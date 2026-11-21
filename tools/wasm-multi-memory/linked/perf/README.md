# pgvector L2 experiment

The extension checks the byte ranges of the two float arrays before the L2
reduction. For private input it loads directly from the backend heap. For
shared input it copies up to 256 floats at a time into a private stack buffer.
The accumulator carries across chunks. An input spanning a pointer-tag boundary
takes the original scalar path.

The linked compiler recognizes one explicit float-load intrinsic and emits
`f32.load` on the extension's sole memory. The experimental pgvector patch
uses the intrinsic only after proving that the operand is in a private range
or copying it to private memory. Each call uses at most 2 KiB of scratch.
Copying relies on pgvector's read-only input contract. This optimization is
specific to its dense L2 kernel. Both constructors load the same extension.

## Reproduce locally

Start with the built linked prototype. From its worktree, use the stock
Postgres checkout, extension source, and matching installed SDK that produced
the original raw pgvector archive. These mounts match the paths recorded by
PGXS in this build. The script builds into temporary directories, checks the
unmodified binary against the original, then builds and packages the experiment.

```sh
stock_checkout=../pglite-final-clean
sdk() {
  docker --context orbstack run --rm -w /work \
    -v "$PWD:/work" \
    -v "$(cd "$stock_checkout/postgres-pglite" && pwd):/work/postgres-pglite:ro" \
    -v "$(cd "$stock_checkout/tools/wasm-multi-memory/.out/postmaster-build" && pwd):/postmaster-build:ro" \
    -v pglite-memory2-simple-node-modules:/work/node_modules:ro \
    pglite-multi-memory-shared-tools:3.1.74-6 "$@"
}
sdk bash tools/wasm-multi-memory/linked/perf/build-vector.sh \
  /work/postgres-pglite/pglite/other_extensions/vector \
  /postmaster-build/source-build \
  /postmaster-build/source-build/extensions/other/vector.tar.gz
sdk bash tools/wasm-multi-memory/linked/verify.sh \
  build/linked/perf/optimized/electric-sql-pglite-pgvector-0.0.5-linked-l2.0.tgz
```

The build runs both L2 binaries against identical inputs for all nine pairs of
private, global and scoped heaps, ten dimensions up to 16,000, and a payload
ending at the last byte of memory. The package verifier then runs the branch's
SQL checks on Node 20 and 22. For performance comparisons use the parent
directory's `compare.sh` with the experiment tarball as its third argument
and a separate results directory as its fourth. To measure detoasting on its
own, run `benchmark.mjs postmaster storage` from a project with the two
packages installed.

## Results

Three rotated runs per configuration on Node 22.13 in OrbStack, 2,048 seeded
768-dimensional vectors, a fresh database each time, serial HNSW builds.
Each row uses its ordinary classic core or its dedicated-scope postmaster.
Only the optimized linked extension uses the private-span L2 implementation.

| Configuration | Top-10 HNSW, ms | HNSW build, s | Inline scan, ms | Default scan, ms | Two sessions, searches/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stock classic | 0.84 | 2.19 | 1.62 | 8.43 | — |
| Linked classic, original | 1.32 | 3.85 | 2.56 | 9.39 | — |
| Linked classic, optimized | 0.87 | 2.24 | 1.76 | 8.94 | — |
| Native multi-memory postmaster | 2.26 | 3.90 | 4.88 | 15.93 | 742 |
| Linked postmaster, original | 3.63 | 3.92 | 8.16 | 26.02 | 523 |
| Linked postmaster, optimized | 1.87 | 2.33 | 5.15 | 24.82 | 883 |

Applying only the extra Wasm optimization pass to the original extension gave
1.47 ms classic and 3.51 ms postmaster for HNSW search. The timing data covers
complete packages and workloads. A native multi-memory extension could also
benefit from specializing its distance loop.

Both default-storage tables contained 4,096 TOAST chunks. Summing
`vector_dims(v)` forces PostgreSQL to fetch each vector and reads its dimension
without doing distance arithmetic. In three independent postmaster runs that
took 12.14 ms linked and 7.06 ms native (executor medians). Storing the same
vectors inline gave 1.24 and 0.89 ms respectively. This narrows the remaining
scan gap to a path that includes heap access, TOAST fetch and copying.

The [compiler-only experiment](loops.md) applies one private-range rule to
unmodified pgvector and compares both backends for L2, L1, and cosine.
