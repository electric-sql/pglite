#!/usr/bin/env bash
# Vary only the two measured rules in the linked postmaster.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
root=/work/tools/wasm-multi-memory/linked/perf/system
for mode in baseline core-only pair-only; do
  mkdir -p "/bench/$mode"
  cd "/bench/$mode"
  rm -rf node_modules package-lock.json
  echo '{"type":"module","private":true}' >package.json
  if [[ $mode == core-only ]]; then
    packages=(/out/packages/candidate/electric-sql-pglite-0*.tgz /sdk/packages/*pgvector*.tgz)
  elif [[ $mode == pair-only ]]; then
    packages=(/sdk/packages/electric-sql-pglite-0*.tgz /out/packages/candidate/*pgvector*.tgz)
  else
    packages=(/sdk/packages/electric-sql-pglite-0*.tgz /sdk/packages/*pgvector*.tgz)
  fi
  npm install --offline --ignore-scripts --no-audit --no-fund /bench/deps/*.tgz "${packages[@]}" /sdk/packages/*postgis*.tgz
  if [[ $mode != core-only ]]; then
    # All four combinations use identical providers to isolate the two compiler rules.
    cp /bench/candidate/node_modules/@electric-sql/pglite/dist/linked-*.wasm node_modules/@electric-sql/pglite/dist/
  fi
done
mkdir -p /out/attribution
variants=(baseline pair-only candidate core-only)
for round in 0 1 2 3; do
  for i in 0 1 2 3; do
    label=${variants[(round+i)%4]}
    prefix=/out/attribution/$round-$label
    cp "$root/workload.mjs" "/bench/$label/system.mjs"
    node22 "/bench/$label/system.mjs" "$label" postmaster attribute "$round" "$prefix.json" >"$prefix.log" 2>&1
    echo "$round $label passed"
  done
done
