#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}
POSTMASTER_TEST_OUT=${PGLITE_POSTMASTER_TEST_OUT:-${SCRIPT_DIR}/.out/postmaster-test}
CLI_TEST_OUT=${PGLITE_CLI_TEST_OUT:-${SCRIPT_DIR}/.out/cli-test}

test "$(docker image inspect "${IMAGE}" --format '{{.Os}}/{{.Architecture}}')" = \
  'linux/arm64'

docker run --rm \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume "${POSTMASTER_TEST_OUT}:/postmaster-test:rw" \
  --volume "${CLI_TEST_OUT}:/cli-test:rw" \
  --volume pglite-postmaster-node-modules:/work/node_modules \
  --volume pglite-multi-memory-pnpm-store:/tmp/pnpm-store \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    test "$(uname -m)" = aarch64
    pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store
    ./tests/cli/run.sh /work /postmaster-test/native /cli-test
  '
