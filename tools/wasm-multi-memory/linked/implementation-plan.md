# A linked wasm32 build for PostgreSQL and the extension catalog

The proposed milestone delivers installable local npm packages from a clean checkout. Classic keeps its worker-free initializer. Postmaster keeps a private heap per backend, a shared cluster heap, and a dedicated scoped heap (memory 2) for parallel workers. The two constructors may ship different PostgreSQL binaries. Each extension ships one archive, with one copy of each Wasm side module, which both constructors load verbatim. Extension authors build through the SDK. Application authors just install the packages.

The original prototype ran the linked postmaster and its embedded modules. The 180-payload Node 20 audit established that the audited Wasm compiles there. Functional coverage is strongest for pgvector. That prototype consumed another checkout's release, edited generated glue and preload data, and derived provider functions from the modules in that build. An independently released extension needs a predictable set of imports. [Prototype](README.md) · [Latest measurements](perf/mixed.md)

## 1. Build an independently usable SDK

Add linked wasm32 to the existing pinned build alongside the native multi-memory reference. Use one pointer-domain analysis with two ways of emitting accesses. Known-private accesses remain direct. The linked emitter uses the provider for global and scoped accesses, and keeps checked dispatch for unknown pointers. Emit linked output before the normal packager assembles archives and preload data. Install the loader hook in the Emscripten source integration. The linked build should be able to emit its final modules starting with ordinary compiler inputs, without a previously packaged native release.

Give the provider a versioned operation list with signatures and semantics for checked loads, stores, atomics and bulk operations. Generate the shared and unshared providers from that list. Exercise offsets, bounds, growth, aliasing and overlapping copies in the existing transformer tests. Put a small extension through the installed SDK *after* the core has been packaged and load it against those exact core bytes. That proves an extension author can release independently.

## 2. Deliver PostgreSQL, pgvector and PostGIS together

Make the first end-to-end build include the classic core, linked postmaster, embedded PostgreSQL modules and both extensions already in the initial release inventory. Run the existing pgvector and PostGIS tests through the public package entry points. PostGIS covers three dependent side modules, raster support and PROJ data files. Exercise a coordinate transformation, a raster operation and an indexed spatial query. Use two postmaster sessions to check transaction visibility, and exercise a parallel worker using memory 2.

Install the resulting tarballs in an empty project. Open the same packages with worker-free classic and with postmaster on Node 20 and 22. Compare the hashes of the extension bytes consumed by each constructor. Verify the static Wasm inventory on Node 20. Keep the native build available to reproduce failures and compare results. [Release inventory](../extensions/wasm32-initial-inventory.json) · [Existing integration scenario](../../../packages/pglite/integration-tests/postmaster/scenarios/extension-artifacts.mjs)

## 3. Cover the shipped catalog and PostgreSQL behavior

Enumerate every shipped extension, including contrib modules in the core package and standalone npm packages. Record the dependencies, supported constructors and existing behavioral test for each. Run SQL-only packages directly and build every compiled module through the same SDK. Exercise an actual feature from each extension in its supported constructors. Preserve existing capability declarations for extensions that need workers or other process features. Record any remaining gaps by extension and failing operation.

Run the upstream core and isolation schedules and the branch's postmaster lifetime, cancellation, crash/restart and stress scenarios on linked and native builds from the same PostgreSQL revision. Use the existing upstream capability ledger to distinguish known failures from new linked regressions. Track backend-specific changes relative to the base PGlite PostgreSQL fork and identify the owner and reason for each. Keep the wasm32 Node package decision distinct from wasm64 or browser-postmaster work. [PostgreSQL test harness](../../../tests/postgres/README.md)

## 4. Measure the whole system and optimize the expensive paths

Begin measurements as soon as the first packages work. Compare stock classic, linked classic, native postmaster and linked postmaster with identical data, durability, query plans and applicable compiler optimizations. Measure point queries, indexed updates, joins, scans of inline and TOASTed values, pgvector search/build, a spatial query and parallel aggregation. Collect warm latency, concurrent throughput at 1/2/4/8 sessions, startup time, per-session memory and package size. Use the same host and rotate the builds. Publish individual runs and a per-workload summary.

Prioritize one extension workload and one PostgreSQL-core workload using profiles. HNSW is ready for a compiler experiment that reads several shared floats per provider call. Every shared read must retain its order and bounds/trap behavior. Unproven cases keep scalar dispatch. For core, start by separating heap access, detoasting and copying on the same rows. Use the results to select the optimization. Apply each rule to both backends where useful and rerun the full workload matrix. This measures both the benefit and the maintenance cost of each general rule.

## Adoption decision

The review deliverables are a clean reproducible build, an independently built extension, a catalog compatibility matrix, differential PostgreSQL test results, a four-runtime performance table and the incremental PostgreSQL/extension source diff. Judge classic compatibility, everyday multi-session SQL, and extension-heavy workloads separately. A persistent cost in a minority workload can be weighed against one portable artifact per extension. Repeated hand edits to third-party sources or a broad concurrent SQL slowdown would materially change that tradeoff.

The [SDK build](sdk/build-all.sh) produces the installable packages from sections 1–3 and runs their Node 20/22 checks. The [step 3 report](qualification/README.md) includes the extension matrix, the differential PostgreSQL results and the fork maintenance ledger. The [step 4 report](perf/system/README.md) compares the four runtimes, evaluates the two compiler rules and records the adoption decision. [Measurements by workload](perf/system/tables.md) · [Individual runs and artifact hashes](perf/system/measurements.json)
