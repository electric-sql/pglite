#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}
POSTMASTER_BUILD_OUT=${PGLITE_POSTMASTER_BUILD_OUT:-${SCRIPT_DIR}/.out/postmaster-build}

docker run --rm \
  --volume "${REPO_ROOT}:/work:rw" \
  --volume "${POSTMASTER_BUILD_OUT}:/postmaster-build:rw" \
  --volume /work/node_modules \
  --volume pglite-multi-memory-pnpm-store:/tmp/pnpm-store \
  --workdir /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export PATH=/opt/node22/bin:${PATH}
    test "${EMCC_CFLAGS}" = "-matomics -mbulk-memory"
    pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store
    rm -rf /postmaster-build/*
    mkdir -p /postmaster-build/source-build
    cd /work/postgres-pglite
    # Keep the configure prefix free of "postgres". The PostgreSQL install
    # makefiles use that substring to append their normal namespace.
    DEBUG=false \
    PGLITE_SHARED_MEMORY=true \
    PGLITE_MULTI_MEMORY_PROVENANCE=true \
    PGLITE_POSTMASTER=true \
    PGLITE_SKIP_THIRD_PARTY_EXTENSIONS=true \
    PGLITE_BUILD_JOBS=4 \
    INSTALL_FOLDER=/postmaster-build/source-build \
      ./build-pglite.sh
    cd /work
    ./tests/postmaster/build-artifact.sh /work
  '
