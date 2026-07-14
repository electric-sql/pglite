#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
# shellcheck source=toolchain.env
source "${SCRIPT_DIR}/toolchain.env"
IMAGE_TAG="${PGLITE_EMSDK_VERSION}-${PGLITE_MULTI_MEMORY_IMAGE_REVISION}"
SHARED_BUILDER_IMAGE=${PGLITE_MULTI_MEMORY_SHARED_BUILDER_IMAGE:-pglite-multi-memory-shared-builder:${IMAGE_TAG}}
SHARED_TOOLS_IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-pglite-multi-memory-shared-tools:${IMAGE_TAG}}
BUILDER_DIR="${REPO_ROOT}/postgres-pglite/pglite/builder"

docker build \
  --progress=plain \
  --tag "${SHARED_BUILDER_IMAGE}" \
  --build-arg "EMSDK_VER=${PGLITE_EMSDK_VERSION}" \
  --build-arg 'PGLITE_WASM_FEATURE_FLAGS=-matomics -mbulk-memory' \
  --file "${BUILDER_DIR}/Dockerfile" \
  "${BUILDER_DIR}" >/dev/null

docker build \
  --tag "${SHARED_TOOLS_IMAGE}" \
  --build-arg "PGLITE_BUILDER_IMAGE=${SHARED_BUILDER_IMAGE}" \
  --build-arg "BINARYEN_COMMIT=${PGLITE_BINARYEN_COMMIT}" \
  --build-arg "EMSDK_VER=${PGLITE_EMSDK_VERSION}" \
  --build-arg "NODE22_VERSION=${PGLITE_NODE22_VERSION}" \
  --build-arg "NODE24_VERSION=${PGLITE_NODE24_VERSION}" \
  --build-arg "PNPM_VERSION=${PGLITE_PNPM_VERSION}" \
  --file "${SCRIPT_DIR}/Dockerfile" \
  "${SCRIPT_DIR}" >/dev/null

printf '%s\n' "${SHARED_TOOLS_IMAGE}"
