# Batching postmaster query messages

A postmaster session used six worker exchanges to run an extended-protocol query. With batching it uses two for a query without parameters and three for one with parameters. In the latter case, the client waits for PostgreSQL’s parameter types before choosing serializers. Both paths send Sync separately for error recovery. Queries with an explicit notice handler retain individual exchanges because the handler can throw before execution. The classic constructors retain individual protocol calls. The implementation is in `cce0c40`.

Both comparisons used production builds installed from local npm tarballs, Node 22.13.0 and OrbStack Linux arm64 on an Apple M4 Max. Four fresh processes per configuration ran serially in rotating order. Each comparison verified identical plans, settings, storage and SQL checks. Tables show medians of the four run medians. The throughput workload varies the lookup key. [Measurements and package hashes](measurements.json)

## Effect on the linked postmaster

| Workload | Before | Batched | Change | Pairs improved |
| --- | ---: | ---: | ---: | ---: |
| Indexed lookup, ms | 0.519 | 0.385 | -25.9% | 4/4 |
| Indexed update, ms | 0.548 | 0.403 | -26.5% | 4/4 |
| Indexed lookups/s, one session | 2,263 | 2,629 | +16.2% | 3/4 |
| Indexed lookups/s, eight sessions | 4,577 | 6,630 | +44.9% | 4/4 |
| HNSW searches/s, eight sessions | 2,163 | 2,590 | +19.7% | 4/4 |
| HNSW top 10, ms | 1.46 | 1.33 | -8.9% | 4/4 |
| Hash join, ms | 12.21 | 13.26 | +8.6% | 1/4 |
| External read, ms | 5.36 | 5.22 | -2.6% | 4/4 |
| External copy and modify, ms | 5.38 | 5.12 | -4.8% | 4/4 |

The full workload showed an 8.6% increase in hash-join latency. We repeated the same join in six paired fresh processes per package with 12 warmups and 80 timed queries per process. Median end-to-end time was 11.36 ms before and 11.15 ms after (-1.8%). A separate 24 executions per process using `EXPLAIN (ANALYZE, TIMING OFF)` measured PostgreSQL execution at 13.02 and 12.93 ms respectively.

## Both memory designs with batching

The native comparison build uses the same two TypeScript source changes. For each build we checked that its Wasm, data, bundled extension archives and runtime identity matched its own previous package. Each postmaster uses a dedicated scoped heap.

| Workload | Native branch classic | Linked classic | Native multi-memory postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| Indexed lookup, ms | 0.137 | 0.130 | 0.286 | 0.350 |
| Indexed update, ms | 0.149 | 0.141 | 0.318 | 0.404 |
| Indexed lookups/s, one session | 7,861 | 8,129 | 2,811 | 2,561 |
| Indexed lookups/s, eight sessions | — | — | 6,622 | 6,586 |
| HNSW searches/s, eight sessions | — | — | 2,829 | 2,838 |
| HNSW top 10, ms | 0.858 | 0.862 | 1.11 | 1.37 |
| Hash join, ms | 5.74 | 5.71 | 10.46 | 13.18 |
| External read, ms | 2.02 | 1.97 | 3.70 | 5.16 |
| External copy and modify, ms | 1.99 | 1.93 | 3.64 | 5.04 |

## Lock-release experiment

Two scratch compiler variants moved the 16-slot relation-lock release loop into a Wasm instance bound to global memory. Across six paired runs per variant, external read latency went from 4.97 to 5.11 ms for the first variant, and from 5.13 to 5.29 ms for the variant with a direct global path and one return value. The latter also took 5.22 ms for external copy versus 5.14 ms for its control. In a separate instrumented run, that variant reduced calls across the instance boundary from 5.88 million to 4.31 million. Neither compiler variant was adopted.

The 86 classic query and protocol tests passed, along with the multi-session correctness scenario. Both constructors passed the packaged pgvector, PostGIS and independent extension probe on Node 20.18.0 and 22.13.0. The recorded full check-world run covers an earlier host package.

## Reproduce

From the PGlite checkout with the recorded packages and SDK image, run both comparisons serially. The first compares the two memory designs with batching, the second compares the previous and new linked releases. The script labels its first input `stock` in both cases.

```sh
export DOCKER_CONTEXT=orbstack PGLITE_LINKED_IMAGE=pglite-parity-final-sdk
export PGLITE_BENCH_DEPS="$PWD/build/linked/parity/deps"
perf=tools/wasm-multi-memory/linked/perf/system
build=build/linked/lock-scan
bash "$perf/run-release.sh" "$build/native/packages" "$build/final" "$build/fair-replay"
bash "$perf/run-release.sh" build/linked/optimization/release/packages "$build/final" "$build/before-after-replay"
```
