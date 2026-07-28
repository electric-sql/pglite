#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
IMAGE=${PGLITE_MULTI_MEMORY_IMAGE:-$("${SCRIPT_DIR}/build-image.sh")}
POSTMASTER_BUILD_OUT=${PGLITE_POSTMASTER_BUILD_OUT:-${SCRIPT_DIR}/.out/postmaster-build}

docker run --rm \
  --env PGLITE_POSTMASTER_INCREMENTAL="${PGLITE_POSTMASTER_INCREMENTAL:-false}" \
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
    if [ "${PGLITE_POSTMASTER_INCREMENTAL}" != true ]; then
      rm -rf /postmaster-build/*
    fi
    mkdir -p /postmaster-build/source-build /postmaster-build/classic-extensions
    # Milestone A normalizes the already released classic artifacts; building
    # the postmaster target must not overwrite that qualified input with a
    # host-toolchain rebuild. The shared target is compiled below and remains
    # an independently audited artifact.
    cp /work/packages/pglite-pgvector/release/vector.tar.gz \
      /postmaster-build/classic-extensions/vector.tar.gz
    cp /work/packages/pglite-postgis/release/postgis.tar.gz \
      /postmaster-build/classic-extensions/postgis.tar.gz
    cd /work/postgres-pglite
    # Keep the configure prefix free of "postgres". The PostgreSQL install
    # makefiles use that substring to append their normal namespace.
    DEBUG=false \
    PGLITE_INCREMENTAL="${PGLITE_POSTMASTER_INCREMENTAL}" \
    PGLITE_SHARED_MEMORY=true \
    PGLITE_MULTI_MEMORY_PROVENANCE=true \
    PGLITE_POSTMASTER=true \
    PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=pglite-transform-runtime-modules \
    PGLITE_RUNTIME_SIDE_MODULE_REPORT_ROOT=/postmaster-build/runtime-modules \
    PGLITE_SKIP_THIRD_PARTY_EXTENSIONS=false \
    PGLITE_THIRD_PARTY_EXTENSION_TARGETS="vector postgis" \
    PGLITE_BUILD_JOBS=4 \
    INSTALL_FOLDER=/postmaster-build/source-build \
      ./build-pglite.sh
    cd /work
    PGLITE_POSTMASTER_PACKAGE_OUT=/work/packages/pglite/release \
      ./tests/postmaster/build-artifact.sh /work
    /work/tools/wasm-multi-memory/extensions/build-initial.sh \
      /postmaster-build/classic-extensions \
      /postmaster-build/source-build/extensions/other \
      /work \
      /postmaster-build/extension-artifacts
  '
