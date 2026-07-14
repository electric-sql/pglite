#!/usr/bin/env bash
set -euo pipefail

INPUT=${1:?input Emscripten SIDE_MODULE is required}
OUTPUT=${2:?output transformed SIDE_MODULE is required}
REPORT=${3:?output transformation report is required}
AUDIT=${4:?output audit report is required}

test -f /.dockerenv || {
  echo 'PGlite side modules must be transformed inside the pinned Docker image' >&2
  exit 1
}
case "$(uname -m)" in
  aarch64 | x86_64) ;;
  *) echo "unsupported build host architecture: $(uname -m)" >&2; exit 1 ;;
esac

SCRIPT_PATH=$(readlink -f -- "${BASH_SOURCE[0]}")
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH}")" && pwd)
INLINE="${OUTPUT}.inline"
REPEAT="${OUTPUT}.repeat"
REPEAT_REPORT="${REPORT}.repeat"
HASH=$(sha256sum "${INPUT}" | cut -d' ' -f1)
FEATURES=(
  --enable-feature atomics
  --enable-feature mutable-globals
  --enable-feature sign-ext
  --enable-feature bulk-memory
  --enable-feature bulk-memory-opt
)

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
    --global-maximum-pages 16384
}

mkdir -p "$(dirname -- "${OUTPUT}")" "$(dirname -- "${REPORT}")" \
  "$(dirname -- "${AUDIT}")"
transform "${INLINE}" "${REPORT}"
transform "${REPEAT}" "${REPEAT_REPORT}"
cmp "${INLINE}" "${REPEAT}"
cmp "${REPORT}" "${REPEAT_REPORT}"
wasm-opt "${INLINE}" -O3 --all-features -o "${OUTPUT}"
node22 "${SCRIPT_DIR}/audit-side-module.mjs" \
  "${INPUT}" "${OUTPUT}" "${REPORT}" "${AUDIT}"
rm -f "${INLINE}" "${REPEAT}" "${REPEAT_REPORT}"
