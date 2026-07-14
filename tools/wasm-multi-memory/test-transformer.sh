#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}

docker run --rm \
  --volume "${REPO_ROOT}:/work:rw" \
  --workdir /work/tools/wasm-multi-memory \
  "${IMAGE}" \
  ./tests/run.sh
