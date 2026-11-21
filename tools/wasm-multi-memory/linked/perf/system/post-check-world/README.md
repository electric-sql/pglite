# Classic and postmaster after check-world

On 2026-11-21 at `42c57f1`, we reran the four release configurations on an Apple M4 Max under OrbStack Linux/arm64 with Node 22.13.0. The production core, pgvector and PostGIS tarball hashes match the releases used for check-world. The benchmark used both public constructors, a fresh process and database per run, 16 MiB of shared buffers, and relaxed durability. All 16 scored runs used the same plans and settings. In every HNSW throughput check, the source vector was the first hit in all 320 self-queries. [Individual runs and hashes](measurements.json) · [Workload](../workload.mjs) · [Qualification inputs](../../../qualification/world-parity.json)

Classic query medians were within 5% across the SQL workloads. Both classic heaps measured 153.6 MiB after installing pgvector and PostGIS. Linked postmaster opened an additional session in 83 ms versus 168 ms for native, and used about 1 GiB less process RSS with eight idle sessions. Native postmaster completed the single-session HNSW search in 1.14 ms and linked in 1.39 ms. The hash join took 22% longer on linked, and fetching or copying external TOAST values took 34–36% longer.

The earlier four-round comparison used the same packages. Across the two comparisons the linked postmaster's single-session HNSW latency penalty was 16–22%, and its eight-session HNSW throughput was 2–10% lower. For the fixed-key point lookup, linked took 27% less time in this run and about 1% less in the earlier one. The two-worker aggregate uses a fresh leader. In the separate probe with an extension-loaded leader, native again raised SQLSTATE `58P01` loading `vector.so`, and linked launched both workers. [Earlier results](../release-tables.md) · [Parallel-worker probe](../parallel-leader.mjs)

The table shows medians of four serial runs per configuration. Each configuration occupied each position in the run order once. The postmaster ratio is linked divided by native. Memory is process RSS or Wasm linear heap size as labeled. Post-installation memory is measured before populating the workload tables.

| Workload | Stock classic | Linked classic | Native postmaster | Linked postmaster | Postmaster ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold startup through SELECT 1, ms | 1,363.5 | 1,267.9 | 2,174.1 | 1,695.6 | 0.78× |
| First CREATE EXTENSION vector and postgis, ms | 2,408.2 | 2,506.8 | 2,649.5 | 2,841.4 | 1.07× |
| Indexed point lookup, ms | 0.129 | 0.126 | 0.551 | 0.403 | 0.73× |
| Indexed update, ms | 0.147 | 0.140 | 0.542 | 0.378 | 0.70× |
| Hash join, ms | 5.67 | 5.64 | 10.87 | 13.22 | 1.22× |
| Indexed PostGIS search, ms | 0.256 | 0.259 | 0.715 | 0.740 | 1.04× |
| Inline, heap only, ms | 0.304 | 0.299 | 0.787 | 0.796 | 1.01× |
| Inline, read byte, ms | 0.316 | 0.309 | 0.850 | 0.753 | 0.89× |
| Inline, copy and modify, ms | 0.420 | 0.421 | 0.963 | 1.11 | 1.15× |
| External, heap only, ms | 0.207 | 0.207 | 0.537 | 0.628 | 1.17× |
| External, read byte, ms | 1.95 | 1.93 | 3.93 | 5.28 | 1.34× |
| External, copy and modify, ms | 1.95 | 1.92 | 3.79 | 5.17 | 1.36× |
| HNSW top 10, ms | 0.829 | 0.818 | 1.14 | 1.39 | 1.22× |
| Build HNSW, ms | 2,055.7 | 2,044.6 | 2,130.4 | 2,196.9 | 1.03× |
| Serial aggregate, ms | 3.90 | 3.90 | 6.62 | 7.51 | 1.13× |
| Two-worker aggregate, ms | — | — | 177.1 | 88.31 | 0.50× |
| point, 1 session(s), queries/s | 7,808.1 | 8,089.8 | 2,312.1 | 2,178.0 | 0.94× |
| hnsw_search, 1 session(s), queries/s | 1,206.7 | 1,222.8 | 881.1 | 720.0 | 0.82× |
| rss, 1 session(s), MiB | 740.6 | 744.1 | 2,404.7 | 1,804.7 | 0.75× |
| privateBytes, 1 session(s), MiB | 153.6 | 153.6 | 192.0 | 192.0 | 1.00× |
| globalBytes, 1 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 1 session(s), MiB | — | — | 0.250 | 0.250 | 1.00× |
| point, 2 session(s), queries/s | — | — | 3,355.6 | 3,270.2 | 0.97× |
| hnsw_search, 2 session(s), queries/s | — | — | 1,304.0 | 1,101.2 | 0.84× |
| rss, 2 session(s), MiB | — | — | 2,508.7 | 1,840.0 | 0.73× |
| privateBytes, 2 session(s), MiB | — | — | 224.0 | 224.0 | 1.00× |
| globalBytes, 2 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 2 session(s), MiB | — | — | 0.375 | 0.375 | 1.00× |
| point, 4 session(s), queries/s | — | — | 4,500.0 | 4,345.7 | 0.97× |
| hnsw_search, 4 session(s), queries/s | — | — | 1,809.6 | 1,649.2 | 0.91× |
| rss, 4 session(s), MiB | — | — | 2,853.8 | 2,083.2 | 0.73× |
| privateBytes, 4 session(s), MiB | — | — | 288.0 | 288.0 | 1.00× |
| globalBytes, 4 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 4 session(s), MiB | — | — | 0.625 | 0.625 | 1.00× |
| point, 8 session(s), queries/s | — | — | 4,572.7 | 4,674.1 | 1.02× |
| hnsw_search, 8 session(s), queries/s | — | — | 2,394.0 | 2,349.6 | 0.98× |
| rss, 8 session(s), MiB | — | — | 3,595.9 | 2,567.0 | 0.71× |
| privateBytes, 8 session(s), MiB | — | — | 416.0 | 416.0 | 1.00× |
| globalBytes, 8 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 8 session(s), MiB | — | — | 1.12 | 1.12 | 1.00× |
| RSS before CREATE EXTENSION, MiB | 878.0 | 831.1 | 2,306.3 | 1,481.0 | 0.64× |
| Peak process RSS, MiB | 983.6 | 973.7 | 4,289.1 | 2,965.2 | 0.69× |
| Additional RSS per session from 1 to 8, MiB | — | — | 172.1 | 108.5 | 0.63× |
| Additional session through first SELECT, ms | — | — | 168.1 | 83.13 | 0.49× |

## Startup diagnostics

One additional instrumented process per configuration. Worker timings overlap.

| Phase | Stock classic | Linked classic | Native postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| Classic create, including nested initdb (ms) | 1,343.5 | 1,230.9 | 725.1 | 799.8 |
| Postmaster extension preparation (ms) | — | — | 429.3 | 437.1 |
| Worker start through online (median ms) | — | — | 11.85 | 11.88 |
| Worker start through runtime ready (median ms) | — | — | 190.0 | 93.40 |
| Wasm instantiation per worker (median ms) | — | — | 24.92 | 4.68 |
| First postmaster connection (ms) | — | — | 207.6 | 151.5 |

## Reproduce

From the PGlite checkout with the recorded packages and SDK image on OrbStack, run the following. The driver writes the raw measurements and full tables in the output directory.

```sh
DOCKER_CONTEXT=orbstack PGLITE_LINKED_IMAGE=pglite-parity-final-sdk \
  PGLITE_BENCH_DEPS="$PWD/build/linked/parity/deps" \
  bash tools/wasm-multi-memory/linked/perf/system/run-release.sh \
  build/linked/system/packages/stock build/linked/parity/final build/linked/world/benchmark-replay
```
