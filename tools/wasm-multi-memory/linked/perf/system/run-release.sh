#!/usr/bin/env bash
# Install the native reference and the complete linked release as ordinary npm applications.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
native=$(cd "${1:?native reference package directory from prepare.sh}" && pwd)
release=$(cd "${2:?linked SDK output}" && pwd)
mkdir -p "${3:?measurement output directory}"
out=$(cd "$3" && pwd)
source "$here/../../../toolchain.env"
image=${PGLITE_LINKED_IMAGE:-pglite-linked-sdk:$PGLITE_EMSDK_VERSION-$PGLITE_MULTI_MEMORY_IMAGE_REVISION}
(cd "$release/packages" && shasum -a 256 -c "$release/core-package.sha256")
deps=()
if [[ -n ${PGLITE_BENCH_DEPS:-} ]]; then deps=(-v "$PGLITE_BENCH_DEPS:/deps:ro"); fi
docker run --rm -v /bench -v "$root:/work:ro" -v "$native:/reference:ro" -v "$release:/release:ro" -v "$out:/out" \
  "${deps[@]}" "$image" bash -lc '
set -euo pipefail
export PATH=/opt/node22/bin:$PATH
here=/work/tools/wasm-multi-memory/linked/perf/system
for engine in stock linked; do
  dir=/reference
  if [[ $engine == linked ]]; then dir=/release/packages; fi
  mkdir -p /bench/$engine
  cd /bench/$engine
  echo "{\"type\":\"module\",\"private\":true}" >package.json
  deps=()
  if [[ -d /deps ]]; then deps=(--offline /deps/*.tgz); fi
  npm install --ignore-scripts --no-audit --no-fund "${deps[@]}" "$dir"/*.tgz
  (cd "$dir" && sha256sum -- *.tgz) >"/out/$engine-packages.sha256"
done
cd /bench
bash "$here/measure.sh" release
for engine in stock linked; do
  cd /bench/$engine
  cp "$here/parallel-leader.mjs" .
  node22 parallel-leader.mjs "$engine" "/out/parallel-leader-$engine.json"
  for mode in classic postmaster; do
    trace="/out/startup-$engine-$mode"
    : >"$trace.jsonl"
    PGLITE_STARTUP_TRACE="$trace.jsonl" node22 --require "$here/startup.cjs" system.mjs "$engine" "$mode" startup 0 "$trace.json"
  done
done'
python3 "$here/release-report.py" "$out"
