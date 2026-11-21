#!/usr/bin/env bash
set -euo pipefail
root=/work/tools/wasm-multi-memory/linked
cd /bench/candidate
cp /sdk/probe/linked_probe.{json,tar.gz} "$root/check-sql.mjs" "$root/sdk/check-extensions.mjs" .
export PGLITE_OBSERVE_MANIFEST=/bench/candidate/sizes.json
jq -s '[.[].extensionManifest.files[] | select(.kind=="side-module")] | group_by(.size) | map({key:(.[0].size|tostring),value:map(.sha256)}) | from_entries' \
  node_modules/@electric-sql/pglite-pgvector/dist/vector.json node_modules/@electric-sql/pglite-postgis/dist/postgis.json linked_probe.json >"$PGLITE_OBSERVE_MANIFEST"
for node in node20 node22; do
  for mode in classic postmaster; do
    export PGLITE_OBSERVE_LOG="/out/$node-$mode-links.jsonl"
    : >"$PGLITE_OBSERVE_LOG"
    "$node" --require "$root/sdk/observe-wasm.cjs" check-sql.mjs "$mode" sdk
    diff -u <(jq -r '.[][]' sizes.json | sort -u) \
      <(jq -r --arg mode "$mode" 'select(if $mode == "classic" then .threadId == 0 else .threadId > 0 end) | .hash' "$PGLITE_OBSERVE_LOG" | sort -u)
  done
done
for engine in stock linked candidate; do
  cp "$root/perf/system/parallel-leader.mjs" "/bench/$engine/"
  node22 "/bench/$engine/parallel-leader.mjs" "$engine" "/out/parallel-leader-$engine.json"
done
