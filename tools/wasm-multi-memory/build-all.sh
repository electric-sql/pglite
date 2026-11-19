#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
case "${1:-}" in
  ''|--workspace) ;;
  *) echo 'usage: build-all.sh [--workspace]' >&2; exit 1 ;;
esac
PGLITE_MULTI_MEMORY_IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}
export PGLITE_MULTI_MEMORY_IMAGE

"${SCRIPT_DIR}/build-classic.sh"
"${SCRIPT_DIR}/build-postmaster.sh"

if [ "${1:-}" = --workspace ]; then
  docker run --rm \
    --volume "${REPO_ROOT}:/work:rw" \
    --volume "${PGLITE_NODE_MODULES_VOLUME:-pglite-postmaster-node-modules}:/work/node_modules" \
    --workdir /work \
    "${PGLITE_MULTI_MEMORY_IMAGE}" \
    bash -lc 'export PATH=/opt/node22/bin:${PATH}; pnpm ts:build'
fi
