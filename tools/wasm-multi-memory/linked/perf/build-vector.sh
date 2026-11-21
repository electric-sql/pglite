#!/usr/bin/env bash
# Invoke inside the pinned SDK with the matching installed postmaster PGXS tree.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
source_dir=${1:?expected pgvector 0.8.1 source directory}
pg_prefix=${2:?expected a built PostgreSQL SDK prefix}
original_archive=${3:?expected raw pgvector archive from the same SDK}
linked=tools/wasm-multi-memory/linked
out=build/linked/perf/optimized
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/src" "$tmp/files"
cp "$source_dir"/src/*.{c,h} "$tmp/src/"
cp "$source_dir/Makefile" "$tmp/"
tar xzf "$original_archive" -C "$tmp/files"
module=lib/postgresql/vector.so
build_vector() {
  make -C "$tmp" PG_CONFIG=/bin/true OPTFLAGS="" PORTNAME=emscripten \
    prefix="$pg_prefix" PGXS="$pg_prefix/lib/postgresql/pgxs/src/makefiles/pgxs.mk" vector.so -j4
}
# Compare against the same input used to establish the baseline.
build_vector
cmp "$tmp/vector.so" "$tmp/files/$module"
patch --directory="$tmp" -p1 < "$linked/perf/vector-private-l2.patch"
build_vector
pglite-transform-side-module "$tmp/vector.so" "$tmp/domain.wasm" "$tmp/domain.json" "$tmp/audit.json"
bash "$linked/compile.sh"
printf '%s %s\n' "$tmp/domain.wasm" "$tmp/linked.wasm" >"$tmp/inputs"
build/linked/lower "$tmp/inputs" "$tmp/shared.wasm" "$tmp/unshared.wasm"
wasm-opt --all-features -O3 "$tmp/linked.wasm" -o "$tmp/files/$module"
node22 tools/wasm-multi-memory/extensions/package-extension.mjs build/linked/ir/config.json \
  "$tmp/files" "$out/vector.tar.gz" "$out/vector.json"
node22 "$linked/pack-vector.mjs" "$out" "$source_dir/LICENSE" linked-l2.0
node20 "$linked/perf/check-domains.mjs" "build/linked/ir/vector/$module" "$tmp/files/$module" packages/pglite/dist
