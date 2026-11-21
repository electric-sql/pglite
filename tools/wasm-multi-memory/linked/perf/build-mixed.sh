#!/usr/bin/env bash
# Uses the controls and routed IR produced by build-loops.sh.
set -euo pipefail
reference=${1:?expected stock SDK build}
linked=tools/wasm-multi-memory/linked
perf="$linked/perf"
out=build/linked/mixed
control=build/linked/loops
module=files/lib/postgresql/vector.so
mkdir -p "$out"
bash "$linked/compile.sh" version-loops perf/profile-operands
build/linked/profile-operands "$control/original.wasm" "$out/profile.wasm"
build/linked/version-loops "$control/original.wasm" "$out/mixed.wasm" --mixed >"$out/mixed.log"
bash "$perf/package-variant.sh" "$reference" "$out" linked profile "$out/profile.wasm"
node20 "$perf/check-domains.mjs" "$control/linked-original/$module" "$out/linked-profile/$module" build/linked/artifacts --check-probe
for mode in postmaster classic; do
  node22 "$out/linked-profile/benchmark.mjs" "$mode" heap-profile >"$out/profile-$mode.json" 2>"$out/profile-$mode.log"
done
for backend in linked native; do
  bash "$perf/package-variant.sh" "$reference" "$out" "$backend" mixed "$out/mixed.wasm"
  engine=node22
  if [[ $backend == linked ]]; then engine=node20; fi
  "$engine" "$perf/check-domains.mjs" "$control/$backend-original/$module" "$out/$backend-mixed/$module" build/linked/artifacts --check-mixed
done
python3 "$perf/check-loop-codegen.py" "$out" --mixed
