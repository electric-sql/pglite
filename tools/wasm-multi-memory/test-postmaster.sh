#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}
POSTMASTER_BUILD_OUT=${PGLITE_POSTMASTER_BUILD_OUT:-${SCRIPT_DIR}/.out/postmaster-build}
POSTMASTER_TEST_OUT=${PGLITE_POSTMASTER_TEST_OUT:-${SCRIPT_DIR}/.out/postmaster-test}

test "$(docker image inspect "${IMAGE}" --format '{{.Os}}/{{.Architecture}}')" = \
  'linux/arm64'

docker run --rm \
  --env PGLITE_POSTMASTER_TEST_REUSE_ARTIFACT="${PGLITE_POSTMASTER_TEST_REUSE_ARTIFACT:-false}" \
  --env PGLITE_POSTMASTER_TEST_REUSE_SOURCE="${PGLITE_POSTMASTER_TEST_REUSE_SOURCE:-false}" \
  --env PGLITE_POSTMASTER_TEST_DEBUG="${PGLITE_POSTMASTER_TEST_DEBUG:-false}" \
  --env PGLITE_POSTMASTER_TEST_ENABLE_PARALLEL="${PGLITE_POSTMASTER_TEST_ENABLE_PARALLEL:-true}" \
  --env PGLITE_POSTMASTER_TEST_REGRESS_TESTS="${PGLITE_POSTMASTER_TEST_REGRESS_TESTS:-}" \
  --env PGLITE_POSTMASTER_TEST_PORT="${PGLITE_POSTMASTER_TEST_PORT:-55436}" \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume "${POSTMASTER_BUILD_OUT}:/postmaster-build:rw" \
  --volume "${POSTMASTER_TEST_OUT}:/postmaster-test:rw" \
  --volume pglite-postmaster-node-modules:/work/node_modules \
  --volume pglite-multi-memory-pnpm-store:/tmp/pnpm-store \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    test "$(uname -m)" = aarch64
    pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store
    ./tests/postmaster/run.sh /work
  '
