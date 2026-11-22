#!/usr/bin/env bash
# Package from source-build products into an isolated JS workspace.
set -euo pipefail
out=${PGLITE_LINKED_OUT:-/work/build/linked/sdk}
workspace=/build/workspace
export PATH="/opt/node22/bin:$PATH"
mkdir -p "$out/packages"
phase=${1:-all}
case "$phase" in core|extensions|all) ;; *) exit 2;; esac
if [[ $phase != extensions ]]; then
  bash /work/tools/wasm-multi-memory/linked/sdk/workspace.sh
  cd "$workspace"
  core=packages/pglite/release
  tools=packages/pglite-tools/release
  mkdir -p "$core" "$tools"
  cp "$out"/classic/bin/{pglite.*,initdb.*} "$core/"
  node22 tools/wasm-multi-memory/linked/sdk/catalog.mjs wrappers "$out"
  while read -r name; do
    cp "$out/extensions/$name.tar.gz" "$core/"
  done < <(jq -r '.[] | select(.bundled) | .name' "$out/catalog.json")
  for tool in pg_dump pg_isready psql pg_restore createdb createuser dropdb dropuser clusterdb vacuumdb reindexdb; do
    cp "$out"/classic/bin/"$tool".* "$tools/"
  done
  classic="$out/classic/bin/pglite.wasm"
  /emsdk/upstream/bin/llvm-objcopy --add-section pglite.linked-unshared=/opt/pglite-linked/linked-unshared.wasm \
    "$classic" "$core/pglite.wasm"
  # Only the custom section should be appended to the classic executable.
  cmp -n "$(stat -c %s "$classic")" "$classic" "$core/pglite.wasm"
  cp /opt/pglite-linked/linked-{shared,unshared}.wasm "$core/"
  pglite-linked-transform "$out/postmaster/bin/pglite.wasm" "$core/postmaster.wasm" "$out/main-report.json" main
  cp "$out/postmaster/bin/pglite.js" "$core/postmaster.js"
  cp "$out/postmaster/bin/pglite.data" "$core/postmaster.data"
  mkdir -p postgres-pglite/src/include/catalog
  cp "$out/classic/include/postgresql/server/catalog/catversion.h" postgres-pglite/src/include/catalog/
  PGLITE_PG_CONFIG_HEADER="$out/postmaster/pg_config.h" node22 tools/wasm-multi-memory/generate-artifact-metadata.mjs
  pnpm --filter @electric-sql/pg-protocol --filter @electric-sql/pglite-utils build
  pnpm -C packages/pglite build
  mkdir -p "$out/development"
  node22 --input-type=module -e "import {pglitePostmasterWasmTarget} from './packages/pglite/dist/index.js'; console.log(JSON.stringify(pglitePostmasterWasmTarget))" >"$out/development/target.json"
  (cd packages/pglite && pnpm pack --pack-destination "$out/packages")
  core_package=$(node22 -p "'electric-sql-pglite-' + require('./packages/pglite/package.json').version + '.tgz'")
  (cd "$out/packages" && sha256sum "$core_package") >"$out/core-package.sha256"
fi
if [[ $phase == core ]]; then exit 0; fi
cd "$workspace"
while read -r name package; do
  dir="packages/$package"
  mkdir -p "$dir/release"
  cp "$out/extensions/$name.tar.gz" "$out/extensions/$name.json" "$dir/release/"
  upstream=/work/postgres-pglite/pglite/other_extensions
  case "$name" in
    vector) cp "$upstream/vector/LICENSE" "$dir/release/PGVECTOR-LICENSE" ;;
    postgis) cp "$upstream/postgis/COPYING" "$upstream/postgis/LICENSE.TXT" "$dir/release/" ;;
  esac
  pnpm -C "$dir" build
  (cd "$dir" && pnpm pack --pack-destination "$out/packages")
done < <(jq -r '.[] | select(.bundled == false) | [.name,(.dir|split("/")[-1])] | @tsv' "$out/catalog.json")
