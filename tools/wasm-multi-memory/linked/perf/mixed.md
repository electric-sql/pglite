# Mixed private/global reads during HNSW search

A profiling build counted the heap tags of both detoasted arguments to
`vector_l2_squared_distance`, the HNSW L2 support function. Counters were
read from the same backend immediately before and after index construction
and after 448 indexed top-10 queries. Each profile was repeated in a fresh
database. These counts come from serial HNSW builds and searches on one
backend. The timed packages contain no counters.

| Runtime and phase | First run | Second run | Operand heaps for every call |
| --- | ---: | ---: | --- |
| Linked postmaster, index build | 3,777,124 | 3,781,686 | private / private |
| Linked postmaster, index search | 404,277 | 405,398 | private / global |
| Linked classic, index build | 3,783,712 | 3,781,530 | private / private |
| Linked classic, index search | 405,278 | 405,646 | private / private |

## Compiler change

The compiler keeps the existing all-private loop. For two input streams it
can emit another copy when a range check proves that the first stream
encountered by the loop is private and the second is global. It recognizes
the SDK's float routing helper by its instruction tree. A change to that
helper that breaks the match falls back to ordinary routing. The compiler
requires no pgvector symbols, source changes, or annotations. Only the
separate test probe names the HNSW support function.

In the unrolled L2, L1 and cosine loops, the mixed path performs two private
reads and two global reads in their original order per iteration. It uses two
Wasm-to-Wasm provider calls in the linked build or two ordinary global-memory
load instructions in the native build. It neither snapshots shared data nor
requires a new provider function. Other heap combinations use the existing
fallback. The linked extension grew by 1,709 bytes (129 compressed).

## Performance

Three rotated runs per configuration on Node 22.13 in OrbStack. Every run
opened a fresh database with the same seeded 2,048 vectors of 768 dimensions,
16 MB shared buffers, serial plans and warm-up. The postmasters used dedicated
scopes. Each arrow compares the private-only compiler pass with the private
plus mixed pass on the same core, using the same stock pgvector library and
final Wasm optimization flags. Scan times are executor medians. All full-scan
checksums agreed for each operator across all configurations. Search time includes
the client round trip. The two-session column counts completed queries. Stock
classic used its ordinary single-memory extension in three subsequent runs.

| Runtime | HNSW search, ms | Two sessions, searches/s | Build index, s | Inline L2 / L1 / cosine scan, ms |
| --- | ---: | ---: | ---: | --- |
| Stock classic reference | 1.01 | — | 2.28 | 1.63 / 1.62 / 1.73 |
| Linked classic | 1.00 → 0.94 | — | 2.28 → 2.28 | 1.61 / 1.59 / 1.69 → 1.57 / 1.57 / 1.66 |
| Linked postmaster | 4.26 → 2.54 | 462 → 737 | 2.43 → 2.44 | 7.29 / 7.40 / 8.36 → 7.59 / 7.33 / 7.54 |
| Native multi-memory postmaster | 2.44 → 1.57 | 737 → 1,085 | 2.42 → 2.45 | 4.55 / 4.27 / 4.78 → 4.51 / 4.24 / 4.71 |

Linked search latency ranged from 2.52 to 2.57 ms with the mixed path, versus
4.21 to 4.30 ms with the private-only pass. Native search latency ranged from
1.36 to 1.61 ms with the mixed path, versus 2.32 to 2.48 ms with the
private-only pass. The linked postmaster takes about 4% longer than native with the private-only
pass and 62% longer than native with the mixed pass.

Each direct timing below uses preloaded 768-dimensional private/global vectors
without SQL execution. Batches alternate between the two packages. Values
are median nanoseconds per call across seven warmed batches of 20,000.

| Backend | L2 | L1 | Cosine |
| --- | ---: | ---: | ---: |
| Linked | 3,227 → 1,524 | 3,284 → 1,476 | 3,004 → 1,798 |
| Native | 1,687 → 523 | 1,692 → 524 | 1,786 → 586 |

## Verification and reproduction

The profile counters were checked with known input heaps. Final binary
disassembly verifies the target of each load or provider call. Five pgvector
operators matched the unmodified compiler output exactly for nine heap
pairings at ten dimensions. A short global heap still traps on an
out-of-bounds load. A vector spanning the global/scoped tag boundary reads
the rest of the vector from scoped memory. The same linked extension passed
classic and postmaster SQL, including parallel execution and HNSW cancellation,
on Node 20.18 and 22.13. The Node 20 multi-session scenario also passed.

Use the OrbStack mounts and `sdk` function in [the private-loop experiment](loops.md#reproduce).
From the built linked worktree run the following commands. The first command
is needed only when the private-loop controls have not already been built.

```sh
perf=tools/wasm-multi-memory/linked/perf
out=build/linked/mixed
sdk bash "$perf/build-loops.sh" /reference
sdk bash "$perf/build-mixed.sh" /reference
sdk bash "$perf/measure-loops.sh" --mixed /baseline/packages/pglite-pgvector
python3 "$perf/summarize-loops.py" "$out/results" versioned mixed
for backend in linked native; do
  sdk node22 "$perf/check-domains.mjs" \
    "build/linked/loops/$backend-versioned/files/lib/postgresql/vector.so" \
    "$out/$backend-mixed/files/lib/postgresql/vector.so" build/linked/artifacts --bench
done
sdk bash tools/wasm-multi-memory/linked/verify.sh \
  "$out/linked-mixed/electric-sql-pglite-pgvector-0.0.5-linked-mixed.0.tgz" "$out"
```

The normal SDK build accepts `build.sh /reference --version-mixed-loops`.
That option produces the same linked extension archive as the benchmark.
Classic and postmaster both use its single published Wasm binary.
