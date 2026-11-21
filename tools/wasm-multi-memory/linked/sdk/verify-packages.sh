#!/usr/bin/env bash
set -euo pipefail
out=$(realpath "${1:?linked build output}")
root=/work
linked=$root/tools/wasm-multi-memory/linked
app=$(mktemp -d)
trap 'rm -rf "$app"' EXIT
workspace=/build/workspace
export PATH="/opt/node22/bin:$PATH"
(cd "$out/packages" && sha256sum -c "$out/core-package.sha256")
addon=$(realpath "$workspace/packages/pglite/node_modules/fs-ext-extra-prebuilt")
nan=$(realpath "$(dirname "$addon")/nan")
(cd "$addon" && npm pack --silent --ignore-scripts --pack-destination "$app")
(cd "$nan" && npm pack --silent --ignore-scripts --pack-destination "$app")
cd "$app"
echo '{"private":true,"type":"module"}' >package.json
npm install --offline --ignore-scripts --no-audit --no-fund "$out"/packages/*.tgz "$app"/*.tgz
cp "$out"/probe/linked_probe.{json,tar.gz} "$linked"/check-sql.mjs "$linked"/sdk/{check-extensions.mjs,observe-wasm.cjs} .
dist="$app/node_modules/@electric-sql/pglite/dist"
vector=node_modules/@electric-sql/pglite-pgvector/dist
gis=node_modules/@electric-sql/pglite-postgis/dist
archives=()
while read -r name package; do
  dir="node_modules/$package/dist"
  shipped=("$dir"/*.tar.gz)
  [[ ${#shipped[@]} = 1 && ${shipped[0]} = "$dir/$name.tar.gz" ]] || {
    echo "expected one $name archive in $dir" >&2; exit 1;
  }
  archives+=("${shipped[0]}")
done < <(jq -r '.[] | select(.bundled == false) | [.name,.importPath] | @tsv' "$out/catalog.json")
diff -u <(jq -r '.[] | select(.bundled) | .name + ".tar.gz"' "$out/catalog.json" | sort) \
  <(cd "$dist" && ls -- *.tar.gz | sort)
PGLITE_AUDIT_LINKED_ARCHIVES=1 python3 "$linked/audit.py" "$dist" "${archives[@]}" linked_probe.tar.gz >"$out/packed-audit.json"

module_sizes() {
  jq -s '[.[].extensionManifest.files[] | select(.kind=="side-module")] | group_by(.size) | map({key:(.[0].size|tostring),value:map(.sha256)}) | from_entries' "$@"
}
module_sizes "$vector/vector.json" "$gis/postgis.json" linked_probe.json >sizes.json
# Run the two upstream package suites against the installed public entry points.
if [[ ${2:-all} != catalog ]]; then
  mkdir tests
  cp "$root"/packages/pglite-{postgis,pgvector}/tests/*.test.ts tests/
  ln -s "$(realpath "$workspace/packages/pglite-pgvector/node_modules/vitest")" node_modules/vitest
  "$workspace/packages/pglite-pgvector/node_modules/.bin/vitest" run tests --testTimeout 30000

  export PGLITE_VERIFY_LAZY_EXTENSIONS=1
  export PGLITE_OBSERVE_MANIFEST="$app/sizes.json"
  for node in node20 node22; do
    for mode in classic postmaster; do
      export PGLITE_OBSERVE_LOG="$out/$node-$mode-links.jsonl"
      : >"$PGLITE_OBSERVE_LOG"
      "$node" --require "$app/observe-wasm.cjs" check-sql.mjs "$mode" sdk
      node22 --input-type=module - "$mode" <<'JS'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const links=fs.readFileSync(process.env.PGLITE_OBSERVE_LOG,'utf8').trim().split('\n').map(line=>JSON.parse(line))
const expected=Object.values(JSON.parse(fs.readFileSync(process.env.PGLITE_OBSERVE_MANIFEST))).flat()
assert.equal(new Set(expected).size,5)
const classic=process.argv[2]==='classic'
assert.deepEqual(new Set(links.filter(x=>classic ? x.threadId===0 : x.threadId>0).map(x=>x.hash)),new Set(expected))
JS
    done
  done
  mkdir packages
  ln -s "$app/node_modules/@electric-sql/pglite" packages/pglite
  node20 "$root/packages/pglite/integration-tests/postmaster/scenarios/postmaster-correctness.mjs" \
    "$app" "$dist/postmaster.wasm" "$dist/postmaster.js" "$dist/postmaster.data" "$out/correctness.json"

  (cd "$workspace" && PGLITE_LINKED_SDK=/opt/pglite-linked vitest run --config tools/wasm-multi-memory/tests/vitest.config.ts transformer-linked.test.ts)
fi
if [[ ${2:-all} != sdk ]]; then
  cp "$linked/qualification"/catalog-{cases,test}.mjs .
  if [[ -z ${PGLITE_CATALOG_FILTER:-} && -z ${PGLITE_CATALOG_NODES:-} ]]; then
    # The existing classic suites also cover CJS and saved data directory reloads.
    pnpm -C "$workspace/packages/pglite" exec vitest run tests/contrib --maxWorkers=2 --minWorkers=1
    while read -r dir; do
      pnpm -C "$workspace/$dir" exec vitest run tests --maxWorkers=2 --minWorkers=1
    done < <(jq -r '.[] | select(.bundled == false and .name != "vector" and .name != "postgis") | .dir' "$out/catalog.json")
  fi
  module_sizes "$out"/extensions/*.json >catalog-sizes.json
  export PGLITE_OBSERVE_MANIFEST="$app/catalog-sizes.json"
  status=0
  for engine in ${PGLITE_CATALOG_NODES:-node20 node22}; do
    results="$out/behavior/$engine"
    for mode in classic postmaster; do
      mkdir -p "$results/$mode"
      while read -r name; do
        if [[ -n ${PGLITE_CATALOG_FILTER:-} && ! $name =~ ${PGLITE_CATALOG_FILTER} ]]; then continue; fi
        rm -f "$results/$mode/$name.json"
        export PGLITE_OBSERVE_LOG="$results/$mode/$name-links.jsonl"
        : >"$PGLITE_OBSERVE_LOG"
        timeout -k 5s 90s "$engine" --require "$app/observe-wasm.cjs" catalog-test.mjs "$mode" "$name" "$out" "$results" >"$results/$mode/$name.log" 2>&1 || status=1
        if [[ ! -f "$results/$mode/$name.json" ]]; then
          jq -n --arg name "$name" --arg mode "$mode" '{name:$name,mode:$mode,status:"fail",error:"process exited before writing a result; inspect the extension log"}' >"$results/$mode/$name.json"
        fi
        jq -c . "$results/$mode/$name.json"
      done < <(jq -r '.[].name' "$out/catalog.json")
    done
  done
  if [[ -z ${PGLITE_CATALOG_FILTER:-} && -z ${PGLITE_CATALOG_NODES:-} ]]; then
    (cd "$root" && node22 "$linked/qualification/catalog-report.mjs" "$out") || status=1
  fi
  exit "$status"
fi
