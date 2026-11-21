#!/usr/bin/env bash
set -euo pipefail
out=${PGLITE_LINKED_OUT:-/work/build/linked/sdk}
mkdir -p "$out/extensions"
node22 tools/wasm-multi-memory/linked/sdk/catalog.mjs plan "$out"
while read -r name source; do
  pglite-linked-package "$out/configs/$name.json" "$out/$source" \
    "$out/extensions/$name.tar.gz" "$out/extensions/$name.json" "$out/reports/$name"
done < <(jq -r '.[] | [.name,.source] | @tsv' "$out/catalog.json")
