# Should PGlite use linked single-memory extensions?

The current release comparison includes compiler-generated ordered reads, Node bulk copies and on-demand extension linking. The measurements below record the earlier scalar and paired-read SDK experiments. [Installed release comparison](release-decision.md)

**Continue with the portable extension format. Keep native multi-memory as the postmaster performance reference.** The qualified linked build gives both constructors the same extension archive and keeps classic query performance close to stock. The cost shows up when a postmaster backend repeatedly reads or copies data from another heap. Linked and native postmaster built the HNSW index in 2.22–2.23 seconds.

| Public package workload | Stock classic | Linked classic | Native postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| Point lookup, ms | 0.132 | 0.133 | 0.363 | 0.487 |
| Indexed update, ms | 0.141 | 0.144 | 0.445 | 0.432 |
| Hash join, ms | 5.76 | 5.93 | 10.23 | 11.82 |
| Scan 1,024 external values and read one byte from each, ms | 1.98 | 2.00 | 3.92 | 5.70 |
| HNSW top-10 search, ms | 0.859 | 0.847 | 1.17 | 2.18 |
| Build HNSW, seconds | 2.09 | 2.15 | 2.23 | 2.22 |
| Two-worker aggregate, ms | — | — | 182 | 183 |
| Point lookups/s, eight sessions | — | — | 4,788 | 4,467 |
| HNSW searches/s, eight sessions | — | — | 2,419 | 1,817 |

These are the **qualified SDK** results. With the experimental compiler, linked postmaster HNSW search falls to **1.82 ms**, against **1.21 ms** for native in the same rounds. Eight-session throughput rises to **2,118 vs 2,387 searches/s**. The eight-session point workload reaches **4,434 vs 4,930 lookups/s**. At four sessions the two postmasters are within 1.3% on point throughput in both stages. All engines return the same vector checksum. The fresh HNSW graphs retrieved the source as top-1 in 319–320 of 320 self-queries in the full matrix.

Startup has a cost even for classic. Fresh initialization through the first SELECT took 1.44 vs 1.39 seconds for qualified linked and stock classic, and 2.94 vs 2.15 seconds for linked and native postmaster. Classic's linear heap after installing the two extensions measured 184.38 vs 153.63 MiB. For each additional postmaster session both builds allocated 32 MiB of private linear memory and 128 KiB of scoped memory. The median increase in **process RSS** from one to eight sessions was 172 vs 166 MiB per added session in the qualified builds. RSS includes Node workers, compiled code and the allocator. [Full before/after tables](tables.md) · [Individual runs, plans and binary hashes](measurements.json)

## Two compiler experiments

**Retain paired reads as a candidate for a versioned provider operation.** Eight instrumented HNSW queries made 5,592,576 global scalar float reads, out of 5,617,925 pgvector provider calls. With identical providers in the four attribution builds, enabling paired reads alone reduced search from 2.36 ms (range 2.17–2.51) to 1.78 ms (1.75–1.79), a 25% latency reduction. The compiler found four loops where it could combine two such reads into one call. It keeps both 32-bit reads in their original order. It verifies the private range against the actual heap size and rejects pairs if it cannot move the second address computation safely. This uses one new provider export and zero changes to pgvector or PostgreSQL C. Native already emits direct global loads. The paired archive requires the new provider, so the existing SDK still emits its qualified V1 archive by default. Supporting independent releases of this optimization requires a declared provider ABI capability or a new ABI version. [Loop rule](../../pair-loads.h) · [Domain and trap checks](../check-domains.mjs)

**Leave constant-offset specialization out of the SDK.** Twelve scans reading one byte from each of the same 1,024 external values generated 5,796,553 non-bulk provider calls, 24,830 cross-heap copies and 39.7 MB of copied data. The inline read generated 542,227 calls and 53 copies. The core experiment baked small constant offsets into Wasm load/store instructions at 846 call sites. It added 323 exports to each provider. The full-matrix linked detoast scan went from 5.70 to 5.96 ms, against 3.92 to 3.93 ms native. In the attribution runs, the external read took 5.89 ms with neither rule, 6.07 ms with offsets alone, 5.70 ms with pairing alone and 5.94 ms with both. The inline copy workload also remains expensive. Direct native loads already encode their offsets. The profile counts boundary crossings across each SQL statement. [Core emitter](provider-immediates.cpp) · [Provider checks](check-providers.mjs) · [Attribution results](tables.md#linked-postmaster-rule-attribution)

## Package verification and parallel execution

Both candidate constructors instantiated the same five Wasm hashes on Node 20.18 and 22.13 (pgvector, three PostGIS modules and the independently built probe). Classic created zero workers. Postmaster passed transaction visibility, parallel pgvector with dedicated scoped memory and cancellation of an active HNSW build. The direct comparison covered five vector operators across 90 dimension/domain combinations, ordered reads under simulated writes, out-of-bounds private/global loads, and a range crossing into scoped memory. The provider comparison covered 1,292 operation, memory-type and growth combinations. The step 3 catalog and upstream regression results apply to the qualified SDK. [SQL checks](../../check-sql.mjs) · [Catalog qualification](../../qualification/README.md)

The core parallel benchmark uses a fresh leader on both postmasters. A separate reproduction ran the same aggregate twice, first on a fresh session and then on one that had executed pgvector and PostGIS. Both linked builds launched two workers in either case. Native launched two with a fresh leader, but the extension-loaded case failed in a parallel worker with SQLSTATE `58P01` when restoring `/pglite/lib/postgresql/vector.so`. That failure is recorded independently of the timings. [Reproduction](parallel-leader.mjs) · [Results](measurements.json)

## Packaging and measurement

The stock pgvector npm tarball was 172 KiB, the linked tarball 75 KiB. For PostGIS these were 40.31 and 14.80 MiB. The stock packages contain a legacy archive as well as one archive per target. Counting **only the two target archives**, stock PostGIS needs 27.69 MiB vs 14.88 MiB for its one linked archive, and stock pgvector needs 111.6 KiB vs 62.1 KiB. PostGIS ships the same three side modules for both linked constructors. The core npm package grew from 15.77 to 16.22 MiB in the qualified build. The candidate adds no PostgreSQL or extension C patches. [Existing PostgreSQL fork maintenance ledger](../../qualification/postgres-fork.md)

- Apple M4 Max, OrbStack Linux/arm64 with 16 CPUs and 15.66 GiB, Node 22.13.0, PostgreSQL 18.3 at `174b8fcb355e62daa4f265cf4a51d99c8a06a422`. Four fresh Node processes and data directories per configuration per stage. All 32 full runs ran serially on the same host. Runtime order rotates, and the order of the two stages alternates. The 16 attribution runs followed. Provider counts came from a separate, untimed process.
- Both reference cores were compiled in production mode with the linked SDK's PostgreSQL export list. The classic PostgreSQL Wasm was byte-identical in all packages. The native extensions use the real shared-memory C target, the same applicable mixed-loop optimization and final Wasm optimization level. Each client installed local npm packages and used the public constructor. No application build or runtime module rewrite occurs.
- 16 MiB shared buffers, synchronous I/O, fsync, synchronous commit and full-page writes disabled. Each process verifies the effective settings. The timing domain is a local, warm data set with relaxed durability. Cold storage, browser and wasm64 performance require separate measurements.
- 32,768 relational rows, an indexed score update, 16,384 spatial points with a GiST index, 2,048 seeded 768-dimensional vectors with an HNSW index. Paired bytea tables hold identical uncompressed 3,072-byte values. The benchmark verifies zero TOAST chunks for PLAIN and 2,048 for EXTERNAL. Heap-only scans sum IDs, read scans fetch one payload byte, and copy scans mutate a copied payload before reading it.
- Point and update latency use 65 queries after 12 warmups on a fixed key. Other serial SQL latencies use nine after three warmups. Warm search latency is the one-session mean per query in the median batch. Concurrent throughput uses the median of three 64-query batches after two warm batches, with varying keys distributed across independent sessions. Index construction is timed once per process. Classic has one session. Parallel aggregates launch two real workers using dedicated scoped heaps with leader participation disabled. The roughly 180 ms figure includes worker startup on this short query.
- Startup includes creating a new database with pgvector and PostGIS registered, opening the first session and running SELECT 1. The SQL CREATE EXTENSION commands follow that measurement. Memory is recorded after installation with 1/2/4/8 idle sessions and before creating the benchmark tables. Reported process medians have four observations. The raw runs show the spread, particularly for sub-millisecond point requests.

## Reproduce with OrbStack

For this historical scalar/paired comparison, use the linked checkout at `5dc2122`, the built native checkout from the same PostgreSQL revision, and the output directory of that revision’s SDK build. The harness reads both and builds the benchmark packages in temporary volumes. To prepare the two inputs from source, run the [SDK build](../../README.md#build-and-verify-from-source-with-orbstack) in the linked checkout and `DOCKER_CONTEXT=orbstack pnpm wasm:build` in a native checkout at `b788fb7c7bca051ee0f9802f04f6792d0226c25d` with its source submodules initialized.

```sh
bench=tools/wasm-multi-memory/linked/perf/system
DOCKER_CONTEXT=orbstack bash "$bench/run.sh" ../pglite-memory2-simple build/linked/qualification/final build/linked/system-replay
```

For the SDK build's default destination, pass `build/linked/sdk` as the second argument. The recorded run used `PGLITE_LINKED_IMAGE=pglite-qual-fixed-sdk` for its locally named SDK image. The script builds both reference cores, prepares the packages, runs the matrix and compiler rule attribution, exercises the candidate packages on Node 20/22, and generates the evidence and tables in its output directory.

A clean-volume packaging replay reproduced all five newly built npm tarballs byte for byte. All 32 scored processes completed. An indentation edit to the shell driver while it was running produced a trailing parse error after the final measurement. The report validator checked every expected result, and the corrected driver traversed the same 32 configurations in the recorded order.

To regenerate just the tables and evidence from the recorded local run, run the following command.

```sh
python3 tools/wasm-multi-memory/linked/perf/system/summarize.py \
  build/linked/system build/linked/qualification/final build/linked/system/report
```
