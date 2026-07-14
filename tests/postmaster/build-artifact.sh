#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?main PGlite repository root is required}
MM_ROOT="${REPO_ROOT}/tools/wasm-multi-memory"
OUT=${PGLITE_POSTMASTER_BUILD_INNER_OUT:-${MM_ROOT}/.out/postmaster-build}
SOURCE_OUT=${PGLITE_POSTMASTER_BUILD_SOURCE_OUT:-${OUT}/source-build}
INPUT="${SOURCE_OUT}/bin/pglite.wasm"
GLUE="${SOURCE_OUT}/bin/pglite.js"
DATA="${SOURCE_OUT}/bin/pglite.data"
INLINE="${OUT}/postmaster.inline.wasm"
CANDIDATE="${OUT}/postmaster.wasm"
REPORT="${OUT}/postmaster.report.json"
EXPORTS="${OUT}/source-function-exports.txt"

test -f "${INPUT}"
test -f "${GLUE}"
test -f "${DATA}"
mkdir -p "${OUT}"
HASH=$(sha256sum "${INPUT}" | cut -d' ' -f1)
FEATURES=(
  --enable-feature atomics
  --enable-feature mutable-globals
  --enable-feature sign-ext
  --enable-feature bulk-memory
  --enable-feature bulk-memory-opt
)

node22 - "${INPUT}" "${EXPORTS}" <<'NODE'
const fs = require('node:fs')
const [input, output] = process.argv.slice(2)
const module = new WebAssembly.Module(fs.readFileSync(input))
const names = WebAssembly.Module.exports(module)
  .filter(({ kind }) => kind === 'function')
  .map(({ name }) => name)
  .sort()
fs.writeFileSync(output, `${names.join('\n')}\n`)
NODE

SUMMARIES=()
while IFS= read -r name; do
  [[ -z "${name}" || "${name}" == \#* ]] && continue
  if grep -Fxq -- "${name}" "${EXPORTS}"; then
    SUMMARIES+=(--private-return-export "${name}")
  fi
done <"${MM_ROOT}/private-return-exports.txt"

transform() {
  local output=$1
  local report=$2
  pglite-wasm-multi-memory "${INPUT}" \
    --output "${output}" \
    --report "${report}" \
    --input-sha256 "${HASH}" \
    "${FEATURES[@]}" \
    --provenance \
    --inline-private-fast-path \
    --global-initial-pages 2 \
    --global-maximum-pages 16384 \
    --wasm-shadow-stack-frame-bytes 1024 \
    --private-identity-export pgl_private_pointer \
    "${SUMMARIES[@]}"
}

transform "${INLINE}" "${REPORT}"
transform "${OUT}/postmaster.inline.repeat.wasm" \
  "${OUT}/postmaster.repeat.report.json"
cmp "${INLINE}" "${OUT}/postmaster.inline.repeat.wasm"
cmp "${REPORT}" "${OUT}/postmaster.repeat.report.json"
wasm-opt "${INLINE}" -O3 --all-features -o "${CANDIDATE}"

node22 "${REPO_ROOT}/tests/postmaster/artifact-audit.mjs" \
  "${INPUT}" "${CANDIDATE}" "${REPORT}" "${OUT}/artifact-audit.json"

pnpm -C "${REPO_ROOT}/packages/pglite" typecheck
pnpm -C "${REPO_ROOT}/packages/pglite" build >/tmp/pglite-postmaster-build.log
pnpm -C "${REPO_ROOT}/packages/pglite" exec vitest run \
  tests/postmaster-primitives.test.ts --maxWorkers=1 --minWorkers=1
pnpm -C "${REPO_ROOT}/packages/pglite" exec eslint \
  src/postmaster tests/postmaster-primitives.test.ts --max-warnings=0

grep -q '__PGLITE_POSTMASTER__' \
  "${REPO_ROOT}/postgres-pglite/src/backend/port/posix_sema.c"
grep -q 'pgl_futex_wait' \
  "${REPO_ROOT}/postgres-pglite/src/backend/port/posix_sema.c"
grep -q 'pgl_spawn_backend' \
  "${REPO_ROOT}/postgres-pglite/src/backend/postmaster/launch_backend.c"

echo 'PGlite postmaster build and artifact tests: PASS'
