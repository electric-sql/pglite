# Linked wasm32 qualification

All 180 catalog runs passed with the packaged PostgreSQL 18.3 cores. Both constructors used the same installed bytes for all 36 contrib archives and nine standalone extension archives. The catalog matrix lists the feature exercised, dependencies, startup requirements, existing test, and result for each public import. [Catalog matrix](catalog.md) · [SQL cases](catalog-cases.mjs) · [Runtime and session checks](catalog-test.mjs)

## Package coverage

The verifier installs the ten local npm tarballs offline into an empty project. Each of the 45 catalog entries gets a fresh database on Node 20.18.0 classic, Node 20.18.0 postmaster, Node 22.13.0 classic and Node 22.13.0 postmaster. It checks archive and Wasm SHA-256 values against the SDK descriptors and records module instantiation in each runtime. Postmaster opens a second session for SQL extensions to exercise catalog visibility and per-backend module loading. Classic also checks that startup and execution create zero workers.

The catalog contains 45 Wasm side modules. PostGIS supplies three and pgmq and pgTAP are SQL-only. The packed static audit compiles 107 Wasm payloads on Node 20, including 28 modules in each core preload and a separately compiled extension probe. The existing classic package suites passed 54 contrib tests, 53 tests across seven standalone packages, and all 12 pgvector/PostGIS tests. The postmaster integration workload also checks parallel pgvector queries using dedicated memory 2, cancellation of an HNSW build, an indexed spatial search, PROJ, GDAL raster and topology.

| Additional distribution | Constructor and operation |
| --- | --- |
| Live queries (core JS plugin) | All 38 classic tests passed, including subscriptions and invalidation. |
| Electric Sync (JS plugin) | All 19 classic tests passed using a mock change stream. |
| Full ICU data | 34 classic tests passed, with the existing German initdb locale test skipped. Postmaster initialized with more than 850 ICU collations. |

Live queries and Electric Sync expose the classic JavaScript setup API. Postmaster extension registration requires a backend descriptor. ICU is an initialization option on both constructors. [Accessory checks](js-extensions.sh)

## PostgreSQL differential

The linked and native multi-memory postmasters use the same PostgreSQL gitlink, `174b8fcb355e62daa4f265cf4a51d99c8a06a422`. Here “native multi-memory” means the reference Wasm build using native Wasm multi-memory instructions. The host-side PostgreSQL client tools and the expected outputs come from that same PostgreSQL revision. Both regression-enabled builds receive the same extension import list and use dedicated scoped memory. This run used Node 22.13.0 in Linux/arm64 containers on OrbStack. [Fork diff and subsystem owners](postgres-fork.md)

| Gate | Linked postmaster | Native multi-memory postmaster |
| --- | ---: | ---: |
| Upstream core regression schedule | 230/230 | 230/230 |
| Upstream isolation schedule | 119/119 | 119/119 |
| Shared-memory lifetime, parallel queries, SQL cancellation and rollback | Pass | Pass |
| Shared preload, static and dynamic background worker launch | Pass | Pass |
| Cluster ownership, brokered filesystem and restart | Pass | Pass |
| pgbench reconnect transactions, four clients | 10,000/10,000 | 10,000/10,000 |
| Live private heaps before churn / after churn / after shutdown | 9 / 9 / 0 | 9 / 9 / 0 |
| DSM/DSA reclamation, injected backend crash and recovery | Pass | Pass |

The upstream schedules use the branch's regression-enabled core and its static test module registry. The catalog uses the ordinary packaged cores and dynamically loaded extensions. The package tests exposed two bugs that the schedules passed over on both original production postmasters.

- **PL/pgSQL exception handlers.** Installing the PostGIS Tiger geocoder intentionally raises and catches an error for a missing schema. With PL/pgSQL dynamically loaded, the backend exited. The Emscripten loader had relocated the main module's thread-local exception state by the static data base while the main module addressed it relative to zero. The SDK loader now resolves exported TLS addresses consistently in shared-memory builds with one Wasm instance per process. The catalog installs Tiger and normalizes an address. [Loader patch](../sdk/emscripten.patch)
- **Logical decoding.** Reading changes for a local publication through `pgoutput` called an unresolved PostgreSQL function, `CacheRegisterRelSyncCallback`. The built-in output plugin uses a backend Makefile outside PGXS. The SDK collects its object imports when building the core export list. The catalog creates a slot, decodes records from a publication, and reads metadata and builder state from a checkpointed logical snapshot. [Export collection](../sdk/classic-runtime-imports.sh)

The fixes ship with the linked SDK. The original native production postmaster reproduces both defects. The [upstream capability ledger](../../../../tests/postgres/postgres-test-capabilities.json) covers other PostgreSQL tests. Multi-cluster replication and backend outbound sockets retain their existing blocked status. This qualification covers the two upstream schedules, the listed scenarios and Node wasm32. Browser postmasters, wasm64, full `check-world` and the four-runtime performance comparison have separate coverage requirements.

## Reproduce with OrbStack

From the PGlite checkout, initialize the pinned sources, build the packaged catalog, then build and test the two regression-enabled postmasters.

```sh
git submodule update --init postgres-pglite
git -C postgres-pglite submodule update --init -- 'pglite/other_extensions/*'
export DOCKER_CONTEXT=orbstack
bash tools/wasm-multi-memory/linked/sdk/build-all.sh
bash tools/wasm-multi-memory/linked/qualification/postgres.sh build/linked/sdk
```

The SDK writes `packages/`, `behavior/<node>/<constructor>/`, `catalog.md`, `catalog-results.json` and `packed-audit.json` under `build/linked/sdk/`. Each behavior result includes the SQL operation and the selected archive digest. Each adjacent `*-links.jsonl` records the module digests and thread IDs observed during that test. Empty link logs are expected for SQL-only archives.

The differential runner writes `{linked,native}-{build,prepare,scenarios,schedules,stress}.log` and per-mode results under `build/linked/qualification/`. The schedules use the full upstream test lists and expected outputs. Inspect `{linked,native}/stress.json` for transaction counts, crash recovery and memory release. Both scripts accept an output directory so a subsequent run can be retained alongside the first.
