# PostgreSQL regression tests

This directory adapts PostgreSQL's native regression harnesses to the packaged
multi-session PGlite command line. It tests the same packed `pglite` executable
that users install; the harness does not import CLI source files directly.

All build and test tooling runs in the pinned multi-memory Docker image. From
the repository root, run:

```sh
PGLITE_POSTGRES_TEST_TARGET=check \
  tools/wasm-multi-memory/test-postgres.sh
```

For the complete supported world:

```sh
PGLITE_POSTGRES_TEST_TARGET=check-world \
  tools/wasm-multi-memory/test-postgres.sh
```

The runner requires a native ARM64 container on Apple Silicon and fails rather
than silently using an emulated AMD64 toolchain. The WebAssembly target remains
unchanged.

## Adapter model

`prepare-test-provider.mjs` creates an isolated provider directory for the
exact checked-out PostgreSQL revision. Its `initdb`, `postgres`, and `pg_ctl`
frontends translate PostgreSQL's temporary-cluster lifecycle onto the packed
CLI while preserving native client programs and arguments. `prove` and the
capability runner wrap exact-revision TAP and make suites so every executed or
skipped area is recorded.

The lifecycle smoke gate runs before either upstream target and verifies:

- initialization and foreground startup;
- readiness and SQL access through the socket frontend;
- smart, fast, and immediate shutdown translation;
- restart of an existing cluster;
- cloned-cluster startup; and
- removal of `postmaster.pid` after clean shutdown.

## Capability policy

[`postgres-test-capabilities.json`](postgres-test-capabilities.json) is tied to
the provider's exact PostgreSQL revision. The default state is `SUPPORTED`.
Narrow rules may mark a suite or TAP file:

- `UNSUPPORTED` when a deliberately absent build or platform feature makes the
  test inapplicable;
- `BLOCKED` when the feature remains meaningful but is not implemented or has
  not passed this gate; or
- `SUPPORTED`, including a narrow override inside a broader rule.

Do not add a rule merely to make `check-world` green. First preserve and inspect
the failing test's output, identify the missing capability, and use the
narrowest exact or prefix match that explains it. A supported failure, failed
cluster lifecycle, stale revision, or upstream non-zero exit fails the summary.
Set `PGLITE_POSTGRES_TEST_RUN_BLOCKED=true` only for deliberate investigation;
it does not reclassify the result.

## Results and reproduction

Results are retained under the Docker output directory printed by the runner.
For each target this includes:

- `results/<target>.log`, the complete upstream output;
- `results/<target>.json`, the machine-readable summary and canonical replay
  command;
- `results/raw-<target>/clusters`, per-cluster lifecycle records;
- the individual capability-event records; and
- the exact native PostgreSQL build tree used by the harness.

The JSON summary is the gate result. It reports upstream status, supported
failures, explicit blocked and unsupported paths, lifecycle failures,
architecture, revision, and parallelism.
