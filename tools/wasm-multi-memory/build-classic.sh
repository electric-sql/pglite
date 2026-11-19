#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
source "${SCRIPT_DIR}/toolchain.env"
IMAGE=${PGLITE_CLASSIC_IMAGE:-pglite-multi-memory-classic-tools:${PGLITE_EMSDK_VERSION}-${PGLITE_MULTI_MEMORY_IMAGE_REVISION}}
if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  "${SCRIPT_DIR}/build-image.sh" >/dev/null
fi

docker run --rm \
  --env PGLITE_BUILD_JOBS="${PGLITE_BUILD_JOBS:-4}" \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume "${REPO_ROOT}/postgres-pglite/dist:/pglite:rw" \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    test -z "${EMCC_CFLAGS}"
    cd /work/postgres-pglite
    DEBUG=false PGLITE_INCREMENTAL=true \
      PGLITE_VERSION=$(node -p "require(\"/work/packages/pglite/package.json\").version") \
      ./build-pglite.sh
    cd /work
    pnpm wasm:copy-pglite
    pnpm wasm:copy-client-tools
    pnpm wasm:copy-initdb
    pnpm wasm:copy-other_extensions
  '
