# Compiler-only private-range loop specialization

The SDK compiles stock pgvector once and examines counted loops in the
pointer-domain Wasm intermediate. For a supported loop it emits a check at
entry. If every byte the loop could read falls in the private pointer range,
the loop uses ordinary Wasm loads from the backend heap. All other inputs
execute the original loop. The extension author supplies no annotations.
Classic and postmaster load the same linked pgvector package.

The prototype recognizes straight-line reductions with non-atomic 32-bit float
loads, a constant power-of-two increment, and an invariant end. It tracks
addresses through locals, shifts, adds and constant ORs. Its range check uses
64-bit arithmetic to rule out wrapping and verifies that the loop reaches its
end. The private path preserves the order of the loads, address side effects
and Wasm bounds traps. Shared reads stay in place, so the compiler needs no
assumptions about concurrent changes. PostgreSQL itself was outside the
scope of this pass evaluation.

## Generated code and correctness

The stock SDK input was `vector.so` with SHA-256
`b96fce0b884ca5bcb85b7a2b759c2debebce760f996c3c014097c5755d96e4a2`.
The compiler specialized 32 loops across 17 functions. In each of L2, L1 and
cosine, the main unrolled loop originally contained four private-pointer
checks, four private loads and four alternative calls. Disassembly of both
final backends shows a private copy with four direct loads and zero calls or
per-element domain checks. The fallback retains the original four checks.

Five operators, including squared L2 and inner product, returned exactly the
same results as their controls for all nine pairings of private, global and
scoped memory at ten dimensions from 1 to 16,000. The guard fixture separately
tests wraparound, null, nonzero induction starts, end-of-memory loads,
side effects and traps. The linked SQL package passed classic and postmaster
on Node 20.18 and 22.13, including parallel query and index-build cancellation.
Node 20, which rejects native multi-memory, compiled all 180 shipped Wasm
payloads in the package audit. The linked optimized vector binary grew from
183,281 to 187,129 bytes (+2.1%). Its extension archive grew by 641 bytes.

## SQL performance

All runs use Node 22.13 in OrbStack with a fresh database of 2,048 seeded
768-dimensional vectors, serial plans and 16 MB shared buffers. Each
before/after pair shares the same core, source binary, SDK flags and final
`wasm-opt -O3`. The sole change is the compiler pass before backend selection.
Each cell is the median of three processes. Scan times are PostgreSQL executor
times from warmed `EXPLAIN ANALYZE` runs with operator order rotated. All
runs produced identical full-scan sums for each operator. Both postmasters
use dedicated scoped memory. Stock classic uses the ordinary single-memory
core and extension, measured in three separate runs after the paired experiment.

| Runtime | Inline L2, ms | Inline L1, ms | Inline cosine, ms | Top-10 HNSW search, ms | HNSW build, s | Two sessions, searches/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stock classic reference | 1.52 | 1.51 | 1.60 | 0.91 | 2.14 | — |
| Linked classic | 2.53 → 1.52 | 2.48 → 1.51 | 3.57 → 1.60 | 1.35 → 1.08 | 4.06 → 2.21 | — |
| Linked postmaster | 7.83 → 7.01 | 8.02 → 7.02 | 7.32 → 8.06 | 3.55 → 4.34 | 3.97 → 2.38 | 526 → 453 |
| Native multi-memory postmaster | 4.70 → 4.33 | 4.43 → 4.01 | 4.94 → 4.55 | 2.57 → 2.53 | 4.11 → 2.33 | 719 → 721 |

Linked postmaster HNSW searches took 3.41–4.48 ms with the pass off and
3.67–4.82 ms with it on. Each of the three paired runs was slower with the
pass on. The ranges overlap and three rounds give limited precision. For
default-storage scans, linked postmaster L2/L1/cosine times changed from
26.38/26.13/27.49 ms to 25.04/25.41/25.52 ms. Native postmaster changed
from 16.67/16.79/18.05 ms to 15.36/15.46/15.54 ms.

## Direct kernel timings

These calls use the actual final pgvector Wasm exports with preloaded inputs,
identity detoasting and no SQL executor. Each number is the median of seven
20,000-call batches after two warm-up batches, in nanoseconds per 768-element
call. The original and optimized variants alternate. Each benchmark fixes
the input domains explicitly.

| Wasm backend and operand heaps | L2 | L1 | Cosine |
| --- | ---: | ---: | ---: |
| Linked, private/private | 958 → 528 | 948 → 510 | 1488 → 552 |
| Native, private/private | 967 → 522 | 954 → 514 | 1518 → 573 |
| Linked, private/global | 2789 → 3090 | 2745 → 3208 | 3428 → 2824 |
| Native, private/global | 1592 → 1626 | 1582 → 1622 | 1669 → 1626 |
| Linked, global/global | 5802 → 5537 | 5642 → 5730 | 6510 → 5782 |
| Native, global/global | 2559 → 2563 | 2575 → 2605 | 2621 → 2680 |

The private kernels converge across backends. For mixed and shared inputs
the linked extension still calls the provider per shared read. The SQL
measurements did not record how often each operand pairing occurred. Measuring
that distribution during HNSW search would tell us which shared case to
specialize next. Automatically copying shared values in chunks, as in the
earlier hand-written L2 experiment, needs evidence that the values are
stable for the duration of the copy and use.

## Reproduce

From a built linked worktree with the shared-tools SDK and dependency volume,
mount the matching stock PGlite build and its dependencies. The baseline
pgvector checkout supplies the optional stock classic reference package.

```sh
sdk() {
  docker --context orbstack run --rm -w /work \
    -v "$PWD:/work" \
    -v "$(cd ../pglite-portable-extensions && pwd):/reference:ro" \
    -v "$(cd ../pglite-memory2-simple && pwd):/baseline:ro" \
    -v pglite-memory2-simple-node-modules:/work/node_modules:ro \
    -v pglite-memory2-simple-node-modules:/reference/node_modules:ro \
    pglite-multi-memory-shared-tools:3.1.74-6 "$@"
}
perf=tools/wasm-multi-memory/linked/perf
out=build/linked/loops
sdk bash "$perf/build-loops.sh" /reference
sdk bash "$perf/measure-loops.sh" /baseline/packages/pglite-pgvector
python3 "$perf/summarize-loops.py" "$out/results"
sdk bash tools/wasm-multi-memory/linked/verify.sh \
  "$out/linked-versioned/electric-sql-pglite-pgvector-0.0.5-linked-versioned.0.tgz" "$out"
for backend in linked native; do
  sdk node22 "$perf/check-domains.mjs" \
    "$out/$backend-original/files/lib/postgresql/vector.so" \
    "$out/$backend-versioned/files/lib/postgresql/vector.so" \
    build/linked/artifacts --bench
done
```

The regular linked SDK build accepts `build.sh /reference --version-private-loops`
to package the specialized extension. The option is experimental given the
postmaster search results. Consumers install and open the package normally.

The [mixed-heap follow-up](mixed.md) measures HNSW operand residency and
specializes the observed private/global case on both backends.
