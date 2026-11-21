#!/usr/bin/env bash
# Compare two packaged linked releases on the storage SQL from the full matrix.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
before=$(cd "${1:?previous SDK release directory}" && pwd)
after=$(cd "${2:?candidate SDK release directory}" && pwd)
mkdir -p "${3:?output directory}"
out=$(cd "$3" && pwd)
source "$here/../../../toolchain.env"
image=${PGLITE_LINKED_IMAGE:-pglite-linked-sdk:$PGLITE_EMSDK_VERSION-$PGLITE_MULTI_MEMORY_IMAGE_REVISION}
mounts=(-v /bench -v "$here:/scripts:ro" -v "$before:/before:ro" -v "$after:/after:ro" -v "$out:/out")
if [[ -n ${PGLITE_BENCH_DEPS:-} ]]; then mounts+=(-v "$PGLITE_BENCH_DEPS:/deps:ro"); fi

docker run --rm -i "${mounts[@]}" "$image" bash -s <<'BENCH'
set -euo pipefail
export PATH=/opt/node22/bin:$PATH PGLITE_STORAGE_SAMPLES=150
for engine in before after; do
  dir=/$engine/packages
  (cd "$dir" && sha256sum -c "/$engine/core-package.sha256" && sha256sum -- *.tgz >"/out/$engine-packages.sha256")
  mkdir -p "/bench/$engine"
  cd "/bench/$engine"
  echo '{"private":true,"type":"module"}' >package.json
  deps=()
  if [[ -d /deps ]]; then deps=(--offline /deps/*.tgz); fi
  npm install --ignore-scripts --no-audit --no-fund "${deps[@]}" "$dir"/*.tgz
  cp /scripts/workload.mjs .
done
for round in 0 1 2 3 4 5; do
  order=(before after)
  if ((round % 2)); then order=(after before); fi
  for engine in "${order[@]}"; do
    prefix="/out/$round-$engine"
    node22 "/bench/$engine/workload.mjs" "$engine" postmaster storage "$round" "$prefix.json" >"$prefix.log" 2>&1 || { tail "$prefix.log" >&2; exit 1; }
    jq -c '[.round,.engine,.latency]' "$prefix.json"
  done
done
BENCH
