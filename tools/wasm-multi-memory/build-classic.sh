#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}

docker run --rm \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume "${REPO_ROOT}/postgres-pglite/dist:/pglite:rw" \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    cd /work/postgres-pglite
    DEBUG=false PGLITE_VERSION=$(node -p "require(\"/work/packages/pglite/package.json\").version") \
      ./build-pglite.sh
    cd /work
    pnpm wasm:copy-pglite
    pnpm wasm:copy-client-tools
    pnpm wasm:copy-initdb
    pnpm wasm:copy-other_extensions
    node tools/wasm-multi-memory/generate-artifact-metadata.mjs
  '
