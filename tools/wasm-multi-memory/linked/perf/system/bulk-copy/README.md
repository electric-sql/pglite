# Reusing byte views for linked memory copies

The linked runtime keeps the source and destination byte views used by each cross-heap copy. After an unshared heap grows, its old view has length zero and the next copy fetches a fresh view. After shared growth, the original view continues to cover its old range. A copy reaching beyond that range refreshes the view and checks both bounds before writing. The packaged classic core, postmaster core, providers, data files and extension archives matched the previous release byte for byte. The runtime change is in the host JavaScript at commit `5ec55ee`.

## Old and new linked postmasters

We alternated the two packaged releases in six paired rounds on Node 22.13.0, Linux arm64 under OrbStack on an Apple M4 Max. Each fresh process ran the same six storage queries, with three warmups and 150 measured executions per query. The table gives the median of the six process medians. External values occupied 2,048 TOAST chunks for 1,024 rows. Each query result, plan and setting matched. [Runs and package hashes](storage.json)

| Workload | Before, ms | After, ms | Change | Pairs faster |
| --- | ---: | ---: | ---: | ---: |
| Inline copy and modify | 0.973 | 0.949 | −2.6% | 3/6 |
| External read byte | 5.370 | 5.143 | −4.2% | 4/6 |
| External copy and modify | 5.394 | 5.116 | −5.1% | 4/6 |

An isolated Wasm-to-host copy from shared to private memory took 139 ns before and 86 ns after (38% less). Each round copied alternating 1,076- and 1,996-byte ranges through the packaged linker, with 20,000 warmups and 400,000 timed copies per variant. All eight rounds favored the cache. The SQL results varied more between processes. For example the inline heap-only median moved from 0.919 to 0.971 ms.

## Four production configurations

The full release workload ran four fresh processes per configuration in rotating order. Each storage query in this workload has nine timed executions after three warmups. The dedicated before/after experiment above measures the effect of the host change. [Full matrix with plans, checks, individual runs and hashes](matrix.json)

| Latency, ms | Native branch classic | Linked classic | Native multi-memory postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| External read byte | 1.96 | 1.98 | 4.02 | 5.36 |
| External copy and modify | 1.93 | 1.95 | 3.91 | 5.15 |
| Hash join | 5.68 | 5.71 | 10.80 | 13.58 |
| HNSW top 10 | 0.838 | 0.838 | 1.19 | 1.42 |

While reading external values, the CPU profile of the previous linked release placed 85 of 1,743 non-wait backend samples in the bulk-copy import. A separate instrumented run attributed 830 of 2,924 sampled provider-call stacks to the relation lock-release routine. Its callers included closing the TOAST index and table. These are call counts and CPU samples from separate, untimed diagnostics.

We also tried moving 1,662 scalar access helpers into a Wasm instance bound to the global heap, retaining access to both other heaps through imports. In four paired scratch runs external read latency rose from 5.07 to 5.77 ms, and external copy from 5.05 to 5.81 ms. Both tables use the existing provider layout.

The focused memory-view tests passed, including overlap across shared growth, detached private buffers and bounds traps before a write. The packed pgvector, PostGIS and independently built probe SQL scenarios passed in both constructors on Node 20.18.0 and 22.13.0. The last full PostgreSQL check-world run covers the previous host package. [Check-world results](../../../qualification/world-parity.json)

## Reproduce

From the repository root with the recorded SDK image and packages, run the two comparisons serially.

```sh
export DOCKER_CONTEXT=orbstack PGLITE_LINKED_IMAGE=pglite-parity-final-sdk
export PGLITE_BENCH_DEPS="$PWD/build/linked/parity/deps"
perf=tools/wasm-multi-memory/linked/perf/system
candidate=build/linked/optimization/release
bash "$perf/compare-storage.sh" build/linked/parity/final "$candidate" build/linked/optimization/storage-replay
bash "$perf/run-release.sh" build/linked/system/packages/stock "$candidate" build/linked/optimization/matrix-replay
```
