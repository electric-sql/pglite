#!/usr/bin/env bash
# Both backends start with the same SDK binary, from unmodified pgvector.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
reference=${1:?expected path to stock build}
out=build/linked/loops
linked=tools/wasm-multi-memory/linked
archive="$reference/tools/wasm-multi-memory/.out/postmaster-build/source-build/extensions/other/vector.tar.gz"
module=lib/postgresql/vector.so
mkdir -p "$out/source"
tar -xzf "$archive" -C "$out/source"
bash "$linked/compile.sh"
pglite-transform-side-module "$out/source/$module" "$out/original.wasm" "$out/domain-report.json" "$out/domain-audit.json"
build/linked/version-loops "$out/original.wasm" "$out/versioned.wasm" >"$out/codegen.log"
for backend in native linked; do
  for version in original versioned; do
    bash "$linked/perf/package-variant.sh" "$reference" "$out" "$backend" "$version" "$out/$version.wasm"
  done
done
sha256sum "$out/source/$module" "$out/original.wasm" "$out/versioned.wasm" "$out"/*/files/"$module" >"$out/sha256.txt"
fixture="$linked/perf/check-loop-guards"
wasm-as --all-features "$fixture.wat" -o "$out/guards.tmp.wasm"
wasm-opt --all-features --emit-target-features "$out/guards.tmp.wasm" -o "$out/guards.wasm"
build/linked/version-loops "$out/guards.wasm" "$out/guards-versioned.wasm" >"$out/guards.log"
grep -E '^[^ ]+ 1 loops 1 guarded loads sum$' "$out/guards.log"
node22 "$fixture.mjs" "$out/guards.wasm" "$out/guards-versioned.wasm"
for backend in linked native; do
  engine=node22
  if [[ $backend == linked ]]; then engine=node20; fi
  "$engine" "$linked/perf/check-domains.mjs" "$out/$backend-original/files/$module" \
    "$out/$backend-versioned/files/$module" build/linked/artifacts
done
python3 "$linked/perf/check-loop-codegen.py" "$out"
