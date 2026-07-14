#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

PATH=/opt/node22/bin:${PATH} vitest run \
  --config "${ROOT}/tests/vitest.config.ts"

"${ROOT}/runtime-capabilities/run.sh" \
  "${ROOT}/.out/transformer-tests/capability.wasm"

echo 'PGlite multi-memory transformer tests: PASS'
