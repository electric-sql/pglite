#!/usr/bin/env bash
# Test the packed public entry points in a new, offline npm project.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
root=$(pwd)
artifacts="$root/build/linked/artifacts"
if [[ $# == 0 ]]; then
  vector_package=("$artifacts"/electric-sql-pglite-pgvector-*.tgz)
else
  vector_package=("$(realpath "$1")")
fi
reports=$(realpath -m "${2:-$root/build/linked}")
mkdir -p "$reports"
app=$(mktemp -d)
trap 'rm -rf "$app"' EXIT
addon=$(realpath packages/pglite/node_modules/fs-ext-extra-prebuilt)
nan=$(realpath "$(dirname "$addon")/nan")
(cd "$addon" && npm pack --silent --ignore-scripts --pack-destination "$app")
(cd "$nan" && npm pack --silent --ignore-scripts --pack-destination "$app")
cd "$app"
echo '{"private":true,"type":"module"}' >package.json
npm install --ignore-scripts --offline --no-audit --no-fund "$app"/*.tgz \
  "$artifacts"/electric-sql-pglite-[0-9]*.tgz "${vector_package[@]}"
scripts="$root/tools/wasm-multi-memory/linked"
dist="$app/node_modules/@electric-sql/pglite/dist"
vector="$app/node_modules/@electric-sql/pglite-pgvector/vector.tar.gz"
python3 "$scripts/audit.py" "$dist" "$vector" | tee "$reports/packed-audit.json"
cp "$scripts/check-sql.mjs" .
for node in node20 node22; do
  "$node" check-sql.mjs classic
  "$node" check-sql.mjs postmaster
done
mkdir -p "$app/packages"
ln -s "$app/node_modules/@electric-sql/pglite" "$app/packages/pglite"
node20 "$root/packages/pglite/integration-tests/postmaster/scenarios/postmaster-correctness.mjs" \
  "$app" "$dist/postmaster.wasm" "$dist/postmaster.js" "$dist/postmaster.data" "$reports/correctness.json"
