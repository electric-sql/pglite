#!/usr/bin/env bash
set -euo pipefail
controls=build/linked/loops
out=$controls
before=original
after=versioned
if [[ ${1:-} == --mixed ]]; then
  shift
  out=build/linked/mixed
  before=versioned
  after=mixed
fi
mkdir -p "$out/results"
for round in 1 2 3; do
  case "$round" in
    1) backends=(linked native); versions=("$before" "$after");;
    2) backends=(native linked); versions=("$after" "$before");;
    3) backends=(linked native); versions=("$after" "$before");;
  esac
  for mode in classic postmaster; do
    for backend in "${backends[@]}"; do
      if [[ $mode == classic && $backend == native ]]; then continue; fi
      for version in "${versions[@]}"; do
        prefix="$out/results/$backend-$version-$mode-$round"
        root=$out
        if [[ $version == "$before" ]]; then root=$controls; fi
        node22 "$root/$backend-$version/benchmark.mjs" "$mode" distances >"$prefix.json" 2>"$prefix.log"
      done
    done
  done
done

# The stock classic package contains its own single-memory extension.
if [[ $# -gt 0 ]]; then
  stock="$out/stock-classic"
  mkdir -p "$stock/node_modules/@electric-sql"
  ln -sfn "$(realpath "$1")" "$stock/node_modules/@electric-sql/pglite-pgvector"
  ln -sfn "$(realpath "$controls/native-original/node_modules/@electric-sql/pglite")" "$stock/node_modules/@electric-sql/pglite"
  cp tools/wasm-multi-memory/linked/benchmark.mjs "$stock/"
  for round in 1 2 3; do
    prefix="$out/results/stock-original-classic-$round"
    node22 "$stock/benchmark.mjs" classic distances >"$prefix.json" 2>"$prefix.log"
  done
fi
