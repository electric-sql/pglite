#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}
POSTMASTER_TEST_OUT=${PGLITE_POSTMASTER_TEST_OUT:-${SCRIPT_DIR}/.out/postmaster-test}
POSTGRES_TEST_OUT=${PGLITE_POSTGRES_TEST_OUT:-${SCRIPT_DIR}/.out/postgres-test}
POSTGRES_TEST_NATIVE_VOLUME=${PGLITE_POSTGRES_TEST_NATIVE_VOLUME:-pglite-multi-memory-postgres-test-native}
POSTGRES_TEST_TARGET=${PGLITE_POSTGRES_TEST_TARGET:-check}
POSTGRES_TEST_DEFAULT_JOBS=2
if [ "${POSTGRES_TEST_TARGET}" = check-world ]; then
  POSTGRES_TEST_DEFAULT_JOBS=1
fi
POSTGRES_TEST_JOBS=${PGLITE_POSTGRES_TEST_JOBS:-${POSTGRES_TEST_DEFAULT_JOBS}}

test "$(docker image inspect "${IMAGE}" --format '{{.Os}}/{{.Architecture}}')" = \
  'linux/arm64'

# PostgreSQL's TAP suites exercise chmod(2) failure paths that Docker Desktop's
# macOS bind mounts do not faithfully reproduce. Keep source and durable test
# reports on the host, but build and execute native regression tools on a
# Docker-managed Linux filesystem with the same unprivileged identity used by
# the test process.
docker volume create "${POSTGRES_TEST_NATIVE_VOLUME}" >/dev/null
docker run --rm \
  --volume "${POSTGRES_TEST_NATIVE_VOLUME}:/postgres-test-native" \
  "${IMAGE}" \
  chown 1000:1000 /postgres-test-native

# Dependency installation mutates the shared pnpm and node_modules volumes,
# which are also used by earlier root-run phases. Prepare them before dropping
# privileges; the PostgreSQL test process below remains unprivileged so its
# filesystem permission checks run with native Linux semantics.
docker run --rm \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume pglite-postmaster-node-modules:/work/node_modules \
  --volume pglite-multi-memory-pnpm-store:/tmp/pnpm-store \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store
  '

docker run --rm \
  --user 1000:1000 \
  --env PGLITE_POSTGRES_TEST_TARGET="${POSTGRES_TEST_TARGET}" \
  --env PGLITE_POSTGRES_TEST_JOBS="${POSTGRES_TEST_JOBS}" \
  --env PGLITE_POSTGRES_TEST_MAX_CONNECTIONS="${PGLITE_POSTGRES_TEST_MAX_CONNECTIONS:-4}" \
  --env PGLITE_SCOPED_MEMORY_LIMIT="${PGLITE_SCOPED_MEMORY_LIMIT:-256MiB}" \
  --env PGLITE_SCOPED_MEMORY_MODE="${PGLITE_SCOPED_MEMORY_MODE:-compact}" \
  --env PGLITE_POSTGRES_TEST_RUN_BLOCKED="${PGLITE_POSTGRES_TEST_RUN_BLOCKED:-false}" \
  --env PGLITE_POSTGRES_TEST_LIFECYCLE_ONLY="${PGLITE_POSTGRES_TEST_LIFECYCLE_ONLY:-false}" \
  --env PGLITE_POSTGRES_TEST_LIFECYCLE_PORT="${PGLITE_POSTGRES_TEST_LIFECYCLE_PORT:-65431}" \
  --env PGLITE_PROVIDER_DEBUG="${PGLITE_PROVIDER_DEBUG:-false}" \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume "${POSTMASTER_TEST_OUT}:/postmaster-test:rw" \
  --volume "${POSTGRES_TEST_OUT}:/postgres-test:rw" \
  --volume "${POSTGRES_TEST_NATIVE_VOLUME}:/postgres-test/native:rw" \
  --volume pglite-postmaster-node-modules:/work/node_modules \
  --volume pglite-multi-memory-pnpm-store:/tmp/pnpm-store \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    test "$(uname -m)" = aarch64
    ./tests/postgres/run.sh /work
  '
