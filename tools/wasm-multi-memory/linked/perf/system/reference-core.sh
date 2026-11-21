#!/usr/bin/env bash
# Compile a production reference with the same PostgreSQL revision and catalog exports as the SDK.
set -euo pipefail
mode=$1
export PATH="/opt/node22/bin:$PATH" INSTALL_FOLDER=/build/install DEBUG=false PGLITE_INCREMENTAL=true
export PGLITE_BUILD_JOBS=${PGLITE_BUILD_JOBS:-8} PGLITE_SKIP_THIRD_PARTY_EXTENSIONS=true
export PGLITE_VERSION=$(node22 -p "require('/work/packages/pglite/package.json').version")
mkdir -p /build/src "$INSTALL_FOLDER" "/out/reference/$mode"
tar xf /sources/postgres.tar -C /build/src
tar xf /sdk/classic/extension-imports.tar -C "$INSTALL_FOLDER"
if [[ $mode == postmaster ]]; then
  export PGLITE_SHARED_MEMORY=true PGLITE_MULTI_MEMORY_PROVENANCE=true PGLITE_POSTMASTER=true
  export PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=pglite-transform-runtime-modules
else
  test "$mode" = classic
fi
cd /build/src
./build-pglite.sh
dest=/out/reference/$mode
if [[ $mode == postmaster ]]; then
  PGLITE_POSTMASTER_ARTIFACT_ONLY=true PGLITE_POSTMASTER_BUILD_INNER_OUT=/build/emitted \
    PGLITE_POSTMASTER_BUILD_SOURCE_OUT="$INSTALL_FOLDER" bash /work/tests/postmaster/build-artifact.sh /work
  cp /build/emitted/{postmaster.wasm,artifact-audit.json} "$dest/"
  cp "$INSTALL_FOLDER/bin/pglite.js" "$dest/postmaster.js"
  cp "$INSTALL_FOLDER/bin/pglite.data" "$dest/postmaster.data"
else
  cp "$INSTALL_FOLDER/bin/"{initdb.*,pglite.*} "$dest/"
fi
