# Runtime-linked single-memory wasm32

Classic and postmaster accept the same 36 bundled contrib archives and nine
standalone extension packages. For example, both use `extensions: { vector, postgis }`
with the public pgvector and PostGIS imports. pgvector ships one side module.
PostGIS ships three, together with their dependency order, SQL and PROJ database.
The packaged bytes run on Node 20.18, which supports one memory per Wasm module.
[Catalog and PostgreSQL qualification](qualification/README.md) · [Installed release comparison](perf/system/release-decision.md)

| Module | Memory it imports | How it reaches another heap |
| --- | --- | --- |
| Classic PostgreSQL | Ordinary backend heap | Classic Postgres produces private pointers |
| Postmaster PostgreSQL and linked extensions | Ordinary heap of the current backend | Calls functions imported from the global or scoped provider |
| Memory access provider | One ordinary or shared heap, fixed at instantiation | Operates on its own heap |

The pointer analysis in the PGlite SDK keeps proven private loads and stores
direct. For a pointer of unknown provenance the generated code reads the pointer
tag, then uses a private instruction or calls the corresponding provider. Each
provider uses Wasm loads, stores and atomics on its single memory. Cross-heap
bulk copies check both ranges and use a Node Buffer copy or a typed-array copy.

Classic binds both providers to its one unshared heap. Postmaster gives each
backend an unshared heap, shares the cluster heap across backends, and shares a
dedicated scoped heap (memory 2) between a session and its parallel workers.
Compact mode requires a shareable private heap and is disabled. The PGlite package ships two
provider binaries of about 7 KiB each, one for each Wasm memory import type.
All loaded extensions use these providers.

## Build and verify from source with OrbStack

From the PGlite repository root, initialize the source revisions once, then run
the SDK build. A local OrbStack Docker context and the pinned toolchain images
are sufficient. The script builds missing base images using the repository's
existing image builder.

```sh
git submodule update --init postgres-pglite
git -C postgres-pglite submodule update --init -- 'pglite/other_extensions/*'
DOCKER_CONTEXT=orbstack bash tools/wasm-multi-memory/linked/sdk/build-all.sh
```

The ten npm tarballs are in `build/linked/sdk/packages/`. Pass an
output directory to the script to keep another build. It reads the pinned C
sources from Git, compiles in fresh Linux volumes and builds the JS packages
from the current PGlite checkout. The native multi-memory reference still
builds through `pnpm wasm:build`.

The SDK uses the existing pointer analysis and its serialized three-domain
intermediate representation. The linked emitter lowers it to a single-memory
client before the embedded modules enter the PostgreSQL preload and before
extension archives are published. The SDK patches Emscripten's loader source.
Application installation and database startup consume the final bytes directly.

The packaged test installs all ten tarballs into an empty npm project. It
runs the existing pgvector and PostGIS suites and exercises every catalog entry
in classic and postmaster on Node 20.18 and 22.13. The integration workload exercises HNSW, a coordinate
transformation, a GDAL raster round-trip, topology, a GiST scan, concurrent
sessions and parallel workers. The verifier records the hashes of the modules
that Wasm actually instantiates in each mode. A separate Node 20 audit compiles
every Wasm payload, including modules embedded in archives and preload data.
The scoped-worker lifetime scenario writes its results to `correctness.json`.

### Extension SDK and provider ABI

`pglite-linked-extension-sdk:local` contains the installed PostgreSQL headers,
the linked compiler and the target metadata exported by the core package. After
packing the core, the build compiles a small C extension in this SDK with
networking disabled and only its source and output directory mounted. The same
package test installs and calls it. Authors still depend on PostgreSQL symbols
exported by the core, as with other Emscripten side modules.
[Independent extension example](sdk/probe/build.sh)

The v1 operation list is fixed when the SDK is built. Both providers export the
same function signatures. A client imports global operations from `pgl_global`
and scoped operations from `pgl_scoped`. Loads, stores, atomics and SIMD
accesses take their Wasm operands followed by the unsigned instruction offset.
The provider checks address overflow and executes the corresponding instruction
on its own heap, preserving bounds and atomic alignment traps. Same-heap copy,
fill, size and growth use ordinary Wasm semantics. The six cross-domain copies
in `pgl_bulk` take destination, source and length in bytes. They check both
ranges before writing, handle overlap when domains alias, and read the current
buffers after growth. [Operation list](sdk/provider-v1.py) · [Emitter](lower.cpp)

The SDK can also emit `pgl_global.load_f32x8_ordered_v1`. Its wasm32 base
address identifies eight float words. The provider reads the high word of each
pair first and returns four packed i64 values. The compiler proves the entire
private range in bounds before grouping these reads. The packager adds
`wasm-linked-f32x8-v1` to the extension's required host capabilities when the
finished module imports the operation. Previously published v1 extensions
continue to use their original functions. [Compiler rule](ordered-loads.h) ·
[Cross-version package checks](sdk/compatibility.sh)

With only packaged linked extensions registered, the runtime installs their
files during setup. Each PostgreSQL process links a library when it first needs
it, loading its manifest `loadAfter` dependencies first. Aliased library paths
retain the validated eager load order.
PostgreSQL still loads libraries requested through `shared_preload_libraries`
during server initialization. The same PostGIS base module supplies symbols
when raster is the first spatial library used in a new backend. After a
synchronous load, the single-threaded classic loader releases its temporary
linear-heap copy of the verified library.

## Reproduce the earlier prototype benchmarks

For the historical benchmark scripts, use the branch
`pglite-multi-memory-shared-tools:3.1.74-6` image with the linked checkout at
`/work`, its workspace dependency links and a stock release checkout at
`/reference` (read-only). Run `bash tools/wasm-multi-memory/linked/build.sh /reference`
to rebuild the lowering pass, runtime, and npm packages. The stock checkout
must contain the built `packages/pglite/release`, the SDK's raw
`source-build/extensions/other/vector.tar.gz`, and the pgvector source license.
The linked checkout uses the normal workspace dependency links.

To compare with stock, additionally mount the dependency volume at
`/reference/node_modules:ro` and a built stock pgvector checkout at
`/baseline:ro`. Run the command below inside the image. It uses a fresh Node
process and Linux filesystem database for each run, and writes individual
measurements and PostgreSQL logs to `build/linked/comparison`.

```sh
bash tools/wasm-multi-memory/linked/compare.sh \
  /reference/packages/pglite /baseline/packages/pglite-pgvector
```

## Measurements

Local OrbStack run on Node 22.13. Each cell is the median of three fresh
databases with 2,048 seeded 768-dimensional vectors, 16 MB shared buffers,
serial plans, and fsync disabled. Timings exclude startup. Stock classic uses
the ordinary classic core and extension. Stock postmaster uses the branch's
native multi-memory core and extension. Both postmasters use dedicated scopes.

| Workload | Stock classic | Linked classic | Stock postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| SELECT 1, ms | 0.111 | 0.106 | 0.392 | 0.423 |
| Top-10 HNSW, ms | 0.852 | 1.278 | 2.269 | 3.552 |
| Default-storage scan, ms | 8.47 | 9.75 | 16.49 | 25.68 |
| Inline-storage scan, ms | 1.68 | 2.75 | 4.88 | 8.49 |
| Build HNSW, s | 2.13 | 3.89 | 3.93 | 3.91 |
| Insert 128 into HNSW, s | 1.06 | 2.07 | 2.26 | 2.73 |
| Two sessions, HNSW queries/s | — | — | 789 | 515 |

The two linked runs use identical pgvector bytes. These measurements include
the differences between the complete compiled extensions. They do not isolate
the cost of a single function call or establish browser performance.

The [compiler-only loop experiment](perf/loops.md) measures an optional SDK
optimization for stock pgvector across both backends.
The [HNSW follow-up](perf/mixed.md) measures the heaps used by index searches
and compares a compiler-generated private/global loop on both runtimes.
