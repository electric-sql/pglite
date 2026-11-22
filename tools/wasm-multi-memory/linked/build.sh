#!/usr/bin/env bash
# Run from the worktree root inside the branch's shared-tools SDK image.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
stock_root=${1:?expected path to an existing stock PGlite SDK build}
source_release="$stock_root/packages/pglite/release"
destination=packages/pglite/release
if [[ "$(realpath "$source_release")" == "$(realpath -m "$destination")" ]]; then
  echo 'Use a separate stock build as the input to preserve the compiler intermediate.' >&2
  exit 1
fi
output=build/linked/artifacts
mkdir -p "$output" "$destination"
bash tools/wasm-multi-memory/linked/compile.sh
python3 tools/wasm-multi-memory/linked/build.py "$source_release" \
  "$stock_root/tools/wasm-multi-memory/.out/postmaster-build/source-build/extensions/other/vector.tar.gz" "$output" "${@:2}"
cp -a "$source_release/." "$destination/"
cp "$output"/{postmaster.wasm,postmaster.js,postmaster.data,pglite.js,pglite.wasm,linked-shared.wasm,linked-unshared.wasm,runtime-identity.json} "$destination/"
node22 tools/wasm-multi-memory/linked/pack-vector.mjs "$output" "$stock_root/postgres-pglite/pglite/other_extensions/vector/LICENSE"
pnpm -C packages/pglite build
(cd packages/pglite && npm pack --ignore-scripts --pack-destination "../../$output" --silent)
