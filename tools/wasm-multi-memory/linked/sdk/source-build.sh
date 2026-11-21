#!/usr/bin/env bash
# Run inside the SDK. Each mode owns its source tree and install prefix.
set -euo pipefail
mode=${1:?classic or postmaster}
out=${PGLITE_LINKED_OUT:-/work/build/linked/sdk}
src=/build/src
export INSTALL_FOLDER=/build/install PATH="/opt/node22/bin:$PATH"
export PGLITE_BUILD_JOBS=${PGLITE_BUILD_JOBS:-8}
export DEBUG=false PGLITE_INCREMENTAL=true
export PGLITE_VERSION=$(node22 -p "require('/work/packages/pglite/package.json').version")
mkdir -p "$src" "$INSTALL_FOLDER" "$out/$mode"
tar -C "$src" -xf /sources/postgres.tar
cd "$src"
case "$mode" in
  classic)
    export PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=/work/tools/wasm-multi-memory/linked/sdk/classic-runtime-imports.sh
    export PGLITE_THIRD_PARTY_EXTENSION_TARGETS='vector postgis age pg_ivm pg_hashids pg_uuidv7 pg_textsearch pgtap pgmq/pgmq-extension'
    for extension in $PGLITE_THIRD_PARTY_EXTENSION_TARGETS; do
      submodule=${extension%%/*}
      tar -C "pglite/other_extensions/$submodule" -xf "/sources/$submodule.tar"
    done
    cp /sources/postgis_revision.h pglite/other_extensions/postgis/
    # libtool cannot infer its language from the placement compiler wrapper.
    # PGXS otherwise takes the injected MAKEFILES fragment as its source directory.
    export MAKEFLAGS="srcdir=. LIBTOOL=$src/pglite/other_extensions/postgis/libtool\ --tag=CC"
    ;;
  postmaster)
    export PGLITE_SHARED_MEMORY=true PGLITE_MULTI_MEMORY_PROVENANCE=true PGLITE_POSTMASTER=true
    export PGLITE_SKIP_THIRD_PARTY_EXTENSIONS=true
    export PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=pglite-linked-runtime-modules
    # The classic build compiles the portable extensions once. Both main
    # modules must export their PGXS imports for Emscripten dynamic linking.
    tar -C "$INSTALL_FOLDER" -xf "$out/classic/extension-imports.tar"
    ;;
  *) exit 2;;
esac
./build-pglite.sh
cp -a "$INSTALL_FOLDER/bin" "$out/$mode/"
if [[ $mode == classic ]]; then
  cp -a "$INSTALL_FOLDER/include" "$out/$mode/"
  cp -a "$INSTALL_FOLDER/extensions" "$out/$mode/"
  (cd "$INSTALL_FOLDER" && find . -name '*.imports' -print0 | tar --null -T - -cf "$out/$mode/extension-imports.tar")
fi
cp src/include/pg_config.h "$out/$mode/"
