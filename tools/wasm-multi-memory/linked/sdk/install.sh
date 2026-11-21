#!/usr/bin/env bash
set -euo pipefail
cd /tmp/linked-sdk
dest=/opt/pglite-linked
mkdir -p "$dest"
bash tools/wasm-multi-memory/linked/compile.sh
install build/linked/{lower,version-loops} "$dest/"
python3 tools/wasm-multi-memory/linked/sdk/provider-v1.py >catalog.wat
wasm-as --all-features catalog.wat -o catalog.wasm
wasm-opt --all-features --emit-target-features catalog.wasm -o provider-input.wasm
echo 'provider-input.wasm client.wasm' >inputs
"$dest/lower" inputs "$dest/linked-shared.wasm" "$dest/linked-unshared.wasm"
install tools/wasm-multi-memory/linked/sdk/transform.sh /usr/local/bin/pglite-linked-transform
install tools/wasm-multi-memory/linked/sdk/runtime-modules.sh /usr/local/bin/pglite-linked-runtime-modules
install tools/wasm-multi-memory/linked/sdk/package.sh /usr/local/bin/pglite-linked-package
cp tools/wasm-multi-memory/private-return-exports.txt "$dest/"
