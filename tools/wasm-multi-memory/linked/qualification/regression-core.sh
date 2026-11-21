#!/usr/bin/env bash
# Build the upstream regression registry and the fixtures it refers to.
set -euo pipefail
mode=$1
export PATH="/opt/node22/bin:$PATH" INSTALL_FOLDER=/build/install DEBUG=false PGLITE_INCREMENTAL=true
export PGLITE_SHARED_MEMORY=true PGLITE_MULTI_MEMORY_PROVENANCE=true PGLITE_POSTMASTER=true
export PGLITE_WITH_REGRESSION_TESTS=true PGLITE_SKIP_THIRD_PARTY_EXTENSIONS=true
export PGLITE_VERSION=$(node22 -p "require('/work/packages/pglite/package.json').version")
case "$mode" in
  linked) export PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=pglite-linked-runtime-modules ;;
  native) export PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=pglite-transform-runtime-modules ;;
  *) exit 2 ;;
esac
mkdir -p /build/src "$INSTALL_FOLDER" /out/{runtime,testlib,fixtures}
tar xf /sources/postgres.tar -C /build/src
tar xf /classic/extension-imports.tar -C "$INSTALL_FOLDER"
cd /build/src
./build-pglite.sh
cp "$INSTALL_FOLDER/bin/pglite.js" /out/runtime/postmaster.js
cp "$INSTALL_FOLDER/bin/pglite.data" /out/runtime/postmaster.data
cp "$INSTALL_FOLDER/lib/postgresql/regress.so" /out/testlib/
tar -xf "$INSTALL_FOLDER/extensions/spi.tar.gz" -C /tmp
cp /tmp/lib/postgresql/*.so /out/testlib/
for module in test_dsa worker_spi; do cp "src/test/modules/$module/$module.so" /out/fixtures/; done
if [[ $mode == linked ]]; then
  pglite-linked-transform "$INSTALL_FOLDER/bin/pglite.wasm" /out/runtime/postmaster.wasm /out/main.json main
else
  PGLITE_POSTMASTER_ARTIFACT_ONLY=true PGLITE_POSTMASTER_BUILD_INNER_OUT=/out/artifact \
    PGLITE_POSTMASTER_BUILD_SOURCE_OUT="$INSTALL_FOLDER" bash /work/tests/postmaster/build-artifact.sh /work
  cp /out/artifact/postmaster.wasm /out/runtime/
fi
