#!/usr/bin/env bash
set -euo pipefail
selection=${1:-all}
case $selection in control|candidate|all) ;; *) exit 2;; esac
root=/work/tools/wasm-multi-memory/linked/perf/system
# Each engine occupies each position once across four fresh-process rounds.
order=(stock-classic linked-classic stock-postmaster linked-postmaster)
for round in 0 1 2 3; do
  phases=(control candidate)
  if ((round%2)); then phases=(candidate control); fi
  for stage in "${phases[@]}"; do
    if [[ $selection != all && $selection != "$stage" ]]; then continue; fi
    out=/out/runs/$stage
    mkdir -p "$out"
    for step in 0 1 2 3; do
      slot=$(((round+step)%4))
      if [[ $stage == candidate ]]; then slot=$((3-slot)); fi
      config=${order[slot]}
      engine=${config%-*}
      mode=${config#*-}
      app=/bench/$engine
      if [[ $stage == candidate && $engine == linked ]]; then app=/bench/candidate; fi
      cp "$root/workload.mjs" "$app/system.mjs"
      prefix="$out/$round-$config"
      node22 "$app/system.mjs" "$engine" "$mode" "$stage" "$round" "$prefix.json" >"$prefix.log" 2>&1 || { tail -c 1200 "$prefix.log" >&2; exit 1; }
      echo "$stage $round $config passed"
    done
  done
done
