# PostgreSQL maintenance surface

Both wasm32 postmasters in the qualification use PostgreSQL 18.3 at `174b8fcb355e62daa4f265cf4a51d99c8a06a422`, the gitlink recorded by PGlite commit `b788fb7`. The common ancestor with the base PGlite fork is `7b4ee5086055dc5e54ae1e13e487888249438e68`. Comparing against that ancestor excludes later, independent changes on the base fork.

| Location | Files | Added | Removed |
| --- | ---: | ---: | ---: |
| PostgreSQL backend (`src/backend`) | 12 | 220 | 62 |
| PGlite build, runtime, placement tools and tests | 26 | 4,322 | 370 |
| Total above the base PGlite fork | 38 | 4,542 | 432 |
| Increment from choosing linked Wasm at this revision | 0 | 0 | 0 |

The following paths are relative to the PostgreSQL submodule. The owner column identifies the subsystem responsible for revisiting each change on a PostgreSQL upgrade.

| Owner | Files | Reason |
| --- | --- | --- |
| Executor | `src/backend/executor/execExprInterp.c` | Mark private expression state and specialize variable reads and the single-variable hash path. |
| Executor | `src/backend/executor/execTuples.c` | Keep slot arrays private, distinguish private and shared tuple payloads, and specialize tuple deformation. These two executor files account for +122/−45. |
| Socket host | `src/backend/libpq/pqcomm.c` | Delegate Unix socket ownership, permissions and lock paths to the host that owns the socket. |
| Process launcher | `src/backend/postmaster/launch_backend.c` | Launch a worker via the PGlite host and read the exact serialized backend-parameter prefix, including when flexible-array padding differs. |
| Process launcher | `src/backend/postmaster/postmaster.c` | Mark the inherited postmaster-alive descriptor absent in a fresh Wasm process. |
| Shared-memory allocator | `src/backend/storage/ipc/dsm.c`, `src/backend/utils/mmgr/dsa.c` | Keep scoped allocations out of PostgreSQL’s global DSM reserve and keep a growing DSA area in the memory domain of its control segment. |
| Signal and wait host | `src/backend/storage/ipc/latch.c`, `src/backend/storage/ipc/pmsignal.c` | Wake the owner worker across isolates and query postmaster liveness through the process host. |
| Session lifecycle | `src/backend/tcop/postgres.c` | Select the classic unrolled main loop or the postmaster backend loop. Restore error and ready-for-query state across classic invocations. |
| Filesystem | `src/backend/utils/init/miscinit.c` | Enable data-directory ownership and permission checks in postmaster mode. |
| Stack guard | `src/backend/utils/misc/stack_depth.c` | Read the Wasm stack cursor and account for Wasm frames when enforcing the SQL stack limit. |
| Build and distribution | `.gitignore`, `build-pglite.sh`, `pglite/build-rules.mk`, `pglite/static/included.pglite.exports` | Track build profiles, configure classic and postmaster, select portable runtime objects and regression fixtures, package tools and extensions, and export the symbols required by dynamic modules. |
| Dependency toolchain | `pglite/builder/Dockerfile`, `pglite/build-pgcrypto.sh`, `pglite/build-postgis.sh` | Build on the native builder architecture, propagate the target flags into dependencies, rebuild on profile changes, and resolve crypto, C++ and GDAL dependencies. |
| PGlite libc and host ABI | `pglite/src/pglitec/pglitec.c`, `pglite/src/pglitec/pglitec.h` | Bridge process launch, signals, timers, sockets, file I/O on tagged buffers, dynamic loading, and shared-segment allocation, attach and reclamation. The C implementation is the largest single diff (+2,061/−288). |
| Process launcher | `pglite/src/pglitec/pglite_backend_launch.h` | Pass the registering leader to the worker launcher so a dynamic worker binds the correct memory 2. |
| Signal and wait host | `pglite/src/postgres-headers/miscadmin.h`, `pglite/src/pglitec/semaphore.c` | Check pending host signals at PostgreSQL interrupt checks and implement semaphores using shared atomics and host waits. |
| Filesystem | `pglite/src/pglitec/directory-entries.js`, `pglite/tests/postmaster/directory-entries.test.mjs` | Normalize dot entries for Emscripten directory reads and exercise the behavior across mounted filesystems. |
| Executor adapters | `pglite/src/pglitec/pglite_provenance.h`, `pglite_exec_expr.h`, `pglite_tuple_access.h`, `pglite_tuple_deform.h` (all in the same directory) | Expose private-pointer proofs to the compiler and isolate executor specialization from upstream call sites. |
| Memory placement | `pglite/src/pglitec/memory-placement.c`, `pglite/tools/memory-placement/root-placement.h` | Select the domain around DSM and DSA creation, including restoration across errors. |
| Compiler integration | `pglite/tools/memory-placement/cc.mjs`, `policy.json`, `README.md` (in the same directory), `pglite/tests/postmaster/memory-placement.test.mjs` | Apply and test source-hash-checked translation-unit overrides. Nine policy entries cover allocation, loader lookup, signals, checkpointing, GUC reporting and executable discovery. Review these hashes on rebase even when Git merges cleanly. |
| Regression toolchain | `pglite/tests/postmaster/generate-static-test-modules.mjs`, `pglite/tests/postmaster/static-libpq-encoding.c` | Provide the static regression module registry and client encoding helpers in Wasm. |

The linked design's incremental maintenance is in the parent repository. The SDK lowers memory accesses, builds the two provider modules and packages the extensions. Its Emscripten integration resolves main-module TLS addresses for side modules, and its core build collects the imports of the built-in pgoutput plugin alongside PGXS extension imports. The PGlite runtime binds providers per process and verifies the shared artifact descriptor. Both designs retain the executor adapters, tagged-pointer conventions, and worker host above. All catalog cases use the pinned third-party extension C sources.

To reproduce the counts from the PGlite checkout:

```sh
base=7b4ee5086055dc5e54ae1e13e487888249438e68
git -C postgres-pglite diff --numstat "$base" 174b8fc
git -C postgres-pglite diff --shortstat "$base" 174b8fc -- src/backend
git rev-parse HEAD:postgres-pglite
```
