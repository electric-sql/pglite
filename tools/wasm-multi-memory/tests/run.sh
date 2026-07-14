#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
OUT=${ROOT}/.out/transformer-tests

rm -rf "${OUT}"
mkdir -p "${OUT}"

node22 "${ROOT}/tests/generate-fixture.mjs" "${OUT}/opcodes.wat"
wasm-opt "${OUT}/opcodes.wat" \
  -o "${OUT}/opcodes.wasm" \
  --all-features \
  --emit-target-features \
  -g \
  --output-source-map="${OUT}/opcodes.wasm.map" \
  --output-source-map-url=opcodes.wasm.map

input_hash=$(sha256sum "${OUT}/opcodes.wasm" | cut -d' ' -f1)
transform() {
  local suffix=$1
  pglite-wasm-multi-memory "${OUT}/opcodes.wasm" \
    -o "${OUT}/opcodes.multi${suffix}.wasm" \
    --input-source-map "${OUT}/opcodes.wasm.map" \
    --output-source-map "${OUT}/opcodes.multi${suffix}.wasm.map" \
    --output-source-map-url opcodes.multi.wasm.map \
    --input-sha256 "${input_hash}" \
    --report "${OUT}/report${suffix}.json" \
    --global-initial-pages 2 \
    --global-maximum-pages 16
}
transform ""
transform ".repeat"
cmp "${OUT}/opcodes.multi.wasm" "${OUT}/opcodes.multi.repeat.wasm"
cmp "${OUT}/opcodes.multi.wasm.map" "${OUT}/opcodes.multi.repeat.wasm.map"
cmp "${OUT}/report.json" "${OUT}/report.repeat.json"
wasm-opt "${OUT}/opcodes.multi.wasm" \
  --all-features \
  --vacuum \
  -o "${OUT}/validated.wasm"
wasm-dis "${OUT}/opcodes.multi.wasm" -o "${OUT}/opcodes.multi.wat"
grep -q '__pglite_mm_' "${OUT}/opcodes.multi.wat"
grep -q 'global_memory' "${OUT}/opcodes.multi.wat"

emcc "${ROOT}/tests/source-map-fixture.c" \
  -O0 \
  -gsource-map \
  --no-entry \
  -sSTANDALONE_WASM=1 \
  -sIMPORTED_MEMORY=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=131072 \
  -sMAXIMUM_MEMORY=1048576 \
  -Wl,--export=source_map_read \
  -Wl,--export=source_map_write \
  -o "${OUT}/source-map.wasm"
source_hash=$(sha256sum "${OUT}/source-map.wasm" | cut -d' ' -f1)
pglite-wasm-multi-memory "${OUT}/source-map.wasm" \
  -o "${OUT}/source-map.multi.wasm" \
  --input-source-map "${OUT}/source-map.wasm.map" \
  --output-source-map "${OUT}/source-map.multi.wasm.map" \
  --output-source-map-url source-map.multi.wasm.map \
  --input-sha256 "${source_hash}" \
  --report "${OUT}/source-map.report.json" \
  --global-initial-pages 2 \
  --global-maximum-pages 16

node22 "${ROOT}/tests/audit-artifacts.mjs" \
  "${OUT}/opcodes.wasm" \
  "${OUT}/opcodes.multi.wasm" \
  "${OUT}/opcodes.wat.inventory.json" \
  "${OUT}/report.json" \
  "${OUT}/opcodes.wasm.map" \
  "${OUT}/opcodes.multi.wasm.map" \
  "${OUT}/source-map.wasm.map" \
  "${OUT}/source-map.multi.wasm.map"
node22 "${ROOT}/tests/runtime-tests.mjs" \
  "${OUT}/opcodes.wasm" \
  "${OUT}/opcodes.multi.wasm" \
  "${OUT}/report.json"

pglite-wasm-multi-memory "${OUT}/opcodes.wasm" \
  -o "${OUT}/opcodes.inline.wasm" \
  --report "${OUT}/report.inline.json" \
  --global-initial-pages 2 \
  --global-maximum-pages 16 \
  --inline-private-fast-path
node22 "${ROOT}/tests/runtime-tests.mjs" \
  "${OUT}/opcodes.wasm" \
  "${OUT}/opcodes.inline.wasm" \
  "${OUT}/report.inline.json"

wasm-opt "${ROOT}/tests/provenance.wat" \
  -o "${OUT}/provenance.wasm" \
  --all-features \
  --emit-target-features
pglite-wasm-multi-memory "${OUT}/provenance.wasm" \
  -o "${OUT}/provenance.multi.wasm" \
  --report "${OUT}/provenance.report.json" \
  --global-initial-pages 2 \
  --global-maximum-pages 16 \
  --provenance \
  --private-return-export palloc \
  --private-identity-export pgl_private_pointer
node22 "${ROOT}/tests/provenance-tests.mjs" \
  "${OUT}/provenance.multi.wasm" \
  "${OUT}/provenance.report.json"

wasm-opt "${ROOT}/tests/capability.wat" \
  -o "${OUT}/capability.wasm" \
  --all-features \
  --emit-target-features

expect_failure() {
  local name=$1
  local expected=$2
  shift 2
  if "$@" >"${OUT}/${name}.log" 2>&1; then
    echo "expected ${name} to fail" >&2
    return 1
  fi
  grep -q "${expected}" "${OUT}/${name}.log"
}

expect_failure already-transformed 'already has PGlite memory ABI metadata' \
  pglite-wasm-multi-memory "${OUT}/opcodes.multi.wasm" \
    -o "${OUT}/must-not-exist.wasm"
expect_failure multiple-input-memories 'exactly one conventional memory' \
  pglite-wasm-multi-memory "${OUT}/capability.wasm" \
    -o "${OUT}/must-not-exist.wasm"
wasm-opt "${ROOT}/tests/unimported-memory.wat" \
  -o "${OUT}/unimported-memory.wasm" \
  --all-features \
  --emit-target-features
expect_failure unimported-memory 'private memory must be imported' \
  pglite-wasm-multi-memory "${OUT}/unimported-memory.wasm" \
    -o "${OUT}/must-not-exist.wasm"
wasm-opt "${ROOT}/tests/oversized-memory.wat" \
  -o "${OUT}/oversized-memory.wasm" \
  --all-features \
  --emit-target-features
expect_failure oversized-memory 'private memory maximum exceeds 2 GiB aperture' \
  pglite-wasm-multi-memory "${OUT}/oversized-memory.wasm" \
    -o "${OUT}/must-not-exist.wasm"
expect_failure invalid-global-limits 'invalid global memory limits' \
  pglite-wasm-multi-memory "${OUT}/opcodes.wasm" \
    -o "${OUT}/must-not-exist.wasm" \
    --global-initial-pages 17 \
    --global-maximum-pages 16
expect_failure invalid-private-return-export \
  'private-return export is not a function' \
  pglite-wasm-multi-memory "${OUT}/provenance.wasm" \
    -o "${OUT}/must-not-exist.wasm" \
    --provenance \
    --private-return-export missing

node20 "${ROOT}/tests/capability-tests.mjs" \
  "${OUT}/capability.wasm" \
  --expect-reject
node22 "${ROOT}/tests/capability-tests.mjs" "${OUT}/capability.wasm"
node24 "${ROOT}/tests/capability-tests.mjs" "${OUT}/capability.wasm"

echo 'PGlite multi-memory transformer tests: PASS'
