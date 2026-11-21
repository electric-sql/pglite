#!/usr/bin/env bash
# Arguments are built stock packages, including their dependency links.
set -euo pipefail
baseline_core=$(realpath "${1:?expected stock PGlite package directory}")
baseline_vector=$(realpath "${2:?expected stock pgvector package directory}")
if [[ $# -ge 3 ]]; then
  linked_vector=("$(realpath "$3")")
else
  linked_vector=(build/linked/artifacts/electric-sql-pglite-pgvector-*.tgz)
fi
output=${4:-"$(pwd)/build/linked/comparison"}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$output"
for variant in linked stock; do
  mkdir -p "$scratch/$variant/node_modules/@electric-sql"
  cp tools/wasm-multi-memory/linked/benchmark.mjs "$scratch/$variant/"
done
ln -s "$baseline_core" "$scratch/stock/node_modules/@electric-sql/pglite"
ln -s "$baseline_vector" "$scratch/stock/node_modules/@electric-sql/pglite-pgvector"
ln -s "$(pwd)/packages/pglite" "$scratch/linked/node_modules/@electric-sql/pglite"
mkdir "$scratch/linked/node_modules/@electric-sql/pglite-pgvector"
tar -xzf "${linked_vector[@]}" \
  -C "$scratch/linked/node_modules/@electric-sql/pglite-pgvector" --strip-components=1
for round in 1 2 3; do
  variants=(linked stock)
  if [[ $round == 2 ]]; then variants=(stock linked); fi
  for mode in classic postmaster; do
    for variant in "${variants[@]}"; do
      node22 "$scratch/$variant/benchmark.mjs" "$mode" \
        >"$output/$variant-$mode-$round.json" 2>"$output/$variant-$mode-$round.log"
    done
  done
done
