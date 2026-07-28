#!/usr/bin/env bash
set -euo pipefail

WASM=${1:?usage: run.sh CAPABILITY_WASM}
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

node20 "${ROOT}/probe.mjs" "${WASM}" --expect-reject
node22 "${ROOT}/probe.mjs" "${WASM}"
node24 "${ROOT}/probe.mjs" "${WASM}"
