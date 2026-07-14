# PGlite multi-memory build and test tooling

This directory contains the WebAssembly multi-memory transformer, the
postmaster build profile, and the integration tests for Node Worker-backed
PostgreSQL sessions.

The transformer converts a conventional wasm32 module with one imported
private memory into the PGlite three-domain ABI:

- memory 0: process-private backend memory;
- memory 1: cluster-global shared memory;
- memory 2: scoped shared memory for parallel-query and transaction lifetimes.

Pointer tags select the memory domain. The transformer proves private
dereferences where possible and emits checked dispatch for everything else.
It fails closed on unknown memory operations, incompatible memory topology,
memory64, invalid apertures, or an already transformed input. The output
contains a `pglite.multi-memory.abi` custom section and the report records
the exact input hash and rewrite inventory.

## Pinned build environment

All compilation, transformation, package installation, and test tooling runs
inside the image built by:

```sh
./tools/wasm-multi-memory/build-image.sh
```

The versions in `toolchain.env` pin Emscripten, Binaryen, Node, and pnpm. The
image derives from the PGlite Wasm builder and includes the native PostgreSQL
test and side-module tools used below. The builder Dockerfile chooses the
native Emscripten base for Docker's `BUILDARCH`; the WebAssembly target is
unchanged.

Do not substitute host Emscripten, Binaryen, Node, package-manager, or native
PostgreSQL build tools. PostgreSQL fork changes should remain small and
compile-time fenced. Platform behavior belongs behind the PGlite libc
abstraction in `pglite/src/pglitec`.

## Commands

Run commands from the parent PGlite checkout.

### Transformer tests

```sh
pnpm wasm:multi-memory:test
```

This runs the TypeScript/Vitest transformer suite, generating exhaustive
fixtures once and validating deterministic lowering, opcode accounting,
pointer-domain traps and aliases, atomics, bulk-memory operations, provenance,
names, and source maps. A separate, deliberately small runtime-capability gate
checks the required multi-memory and Worker-transfer behavior in the pinned
Node versions.
Results are written to `tools/wasm-multi-memory/.out/transformer-tests`.

### Build the postmaster artifact

```sh
pnpm wasm:postmaster:build
```

This makes a clean shared/atomics PostgreSQL build with the postmaster and
source-provenance profiles, transforms and optimizes the generated Wasm twice,
audits its ABI and process exports, and instantiates the real artifact in
multiple Node Workers. It also runs the focused TypeScript tests for process
control, signals, timers, semaphores, connection rings, and virtual sockets.
The audited `postmaster.wasm`, Emscripten glue, and preload data are copied to
`packages/pglite/release` inside the pinned container, then included in the
normal package build. Consumers therefore do not need to provide artifact
paths to `PGlitePostmaster.create()`.

The default output is `tools/wasm-multi-memory/.out/postmaster-build`.
Override it with `PGLITE_POSTMASTER_BUILD_OUT`.

### Postmaster integration tests

```sh
pnpm wasm:postmaster:test
```

This rebuilds the backend with PostgreSQL regression support and exercises:

- session isolation, MVCC, locks, deadlocks, cancellation, and notifications;
- hierarchical shared-memory scopes and parallel queries;
- compact memory binding and transformed dynamic side modules;
- pluggable and brokered filesystems;
- native libpq, TCP/Unix socket, COPY, and backpressure behavior;
- the upstream core and isolation schedules;
- repeated session creation, memory reclamation, crash, and restart behavior.

The command consumes `tools/wasm-multi-memory/.out/postmaster-build` and writes
`tools/wasm-multi-memory/.out/postmaster-test`. The corresponding overrides are
`PGLITE_POSTMASTER_BUILD_OUT` and `PGLITE_POSTMASTER_TEST_OUT`.
For a focused upstream regression selection, set
`PGLITE_POSTMASTER_TEST_REGRESS_TESTS`.

### PostgreSQL `make check` and `make check-world`

```sh
pnpm wasm:postmaster:test:postgres
PGLITE_POSTGRES_TEST_TARGET=check-world pnpm wasm:postmaster:test:postgres
```

The provider exposes the Worker-backed postmaster through PostgreSQL's normal
test executables. It runs on a Docker-managed Linux filesystem as an
unprivileged user so TAP permission tests retain native Linux semantics.
Unsupported and blocked suites are classified by
`postgres-test-capabilities.json`; supported failures fail the command.

This command consumes `tools/wasm-multi-memory/.out/postmaster-test` and writes
reports and native test builds to `tools/wasm-multi-memory/.out/postgres-test`.
Override the directory with `PGLITE_POSTGRES_TEST_OUT`, parallelism with
`PGLITE_POSTGRES_TEST_JOBS`, and the target with
`PGLITE_POSTGRES_TEST_TARGET`.

The commands are intentionally layered: the PostgreSQL suite reuses the
postmaster integration artifact, and the integration suite reuses the clean
postmaster build. Set the documented `*_REUSE_*` variables only while
iterating locally; release evidence should come from clean inputs.

## Dynamic side modules

Postmaster-compatible extensions use normal Emscripten dynamic linking and are
then lowered to the same ABI as the main module. Compile the raw
`SIDE_MODULE=1` inside the pinned image with shared memory, atomics,
bulk-memory, and the PGlite libc headers. Transform the finalized module with:

```sh
pglite-transform-side-module \
  extension.raw.so extension.so extension.report.json extension.audit.json
```

The command repeats the transform, requires byte-identical Wasm and reports,
optimizes the output, and audits `dylink.0`, exports, memory imports, ABI
metadata, and hashes. The postmaster loader rejects classic, untransformed, or
ABI-incompatible modules. Single-user and postmaster builds therefore publish
separate extension artifacts from the same source.

## Directory map

- `tools/wasm-multi-memory/transformer/`: the native Binaryen lowering tool;
- `tools/wasm-multi-memory/tests/`: focused transformer fixtures and tests;
- `tools/wasm-multi-memory/runtime-capabilities/`: minimal pinned-Node
  admission checks, separate from transformer correctness;
- `tools/wasm-multi-memory/side-modules/`: deterministic extension lowering
  and ABI audit tooling;
- `tools/wasm-multi-memory/emscripten/`: the pinned dynamic-loader patch;
- `tests/postmaster/`: artifact construction and end-to-end orchestration;
- `tests/postgres/`: the upstream regression provider and result classifier;
- `packages/pglite/integration-tests/postmaster/`: PGlite API and runtime
  integration scenarios;
- `packages/pglite-socket/integration-tests/`: native socket-client scenarios;
- `postgres-pglite/pglite/tests/postmaster/`: PostgreSQL-build-only fixture
  generation.

Generated output is ignored under `tools/wasm-multi-memory/.out`.
