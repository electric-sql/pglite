#!/usr/bin/env bash
# Package a single pgvector compiler intermediate with either memory backend.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
reference=$1
out=$2
backend=$3
version=$4
input=$5
linked=tools/wasm-multi-memory/linked
archive="$reference/tools/wasm-multi-memory/.out/postmaster-build/source-build/extensions/other/vector.tar.gz"
source_license="$reference/postgres-pglite/pglite/other_extensions/vector/LICENSE"
module=lib/postgresql/vector.so
dest="$out/$backend-$version"
mkdir -p "$dest/files" "$dest/node_modules/@electric-sql/pglite-pgvector"
tar -xzf "$archive" -C "$dest/files"
if [[ $backend == linked ]]; then
  printf '%s %s\n' "$input" "$dest/lowered.wasm" >"$dest/inputs"
  build/linked/lower "$dest/inputs" "$dest/shared.wasm" "$dest/unshared.wasm"
  input="$dest/lowered.wasm"
  config=build/linked/ir/config.json
  core="$(pwd)/packages/pglite"
else
  config=packages/pglite-pgvector/extension-artifacts/wasm32-multi-memory.json
  core="$reference/packages/pglite"
fi
wasm-opt --all-features -O3 "$input" -o "$dest/files/$module"
node22 tools/wasm-multi-memory/extensions/package-extension.mjs "$config" "$dest/files" "$dest/vector.tar.gz" "$dest/vector.json"
node22 "$linked/pack-vector.mjs" "$dest" "$source_license" "$backend-$version.0"
tar -xzf "$dest"/electric-sql-pglite-pgvector-*.tgz -C "$dest/node_modules/@electric-sql/pglite-pgvector" --strip-components=1
ln -sfn "$core" "$dest/node_modules/@electric-sql/pglite"
cp "$linked/benchmark.mjs" "$dest/"
