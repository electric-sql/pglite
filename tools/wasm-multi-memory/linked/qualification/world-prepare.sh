#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/node22/bin:$PATH
bash /work/tools/wasm-multi-memory/linked/sdk/workspace.sh
cd /build/workspace
ln -s /work/postgres-pglite postgres-pglite
: >/postgres-test/world-inputs.sha256
for package in pglite pglite-pgvector pglite-postgis; do
  archive=(/packages/electric-sql-"$package"-[0-9]*.tgz)
  test "${#archive[@]}" = 1
  (cd /packages && sha256sum "$(basename "${archive[0]}")") >>/postgres-test/world-inputs.sha256
  tar -xf "${archive[0]}" -C "packages/$package" --strip-components=1 package/dist
done
(cd /regression/runtime && sha256sum postmaster.{wasm,js,data}) >>/postgres-test/world-inputs.sha256
(cd tests/postgres && sha256sum postgres-test-capabilities.json) >>/postgres-test/world-inputs.sha256
# A release and a regression build have different bytes, but must have the same memory ABI.
node22 --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const abi = path => {
  const module = new WebAssembly.Module(readFileSync(path))
  const sections = ['pglite.linked-memory.abi', 'pglite.multi-memory.abi'].filter(
    name => WebAssembly.Module.customSections(module, name).length === 1)
  assert.equal(sections.length, 1)
  return sections[0]
}
const release = abi('packages/pglite/dist/postmaster.wasm')
assert.equal(abi('/regression/runtime/postmaster.wasm'), release)
writeFileSync('/postgres-test/world-abi.txt', release + '\n')
console.log('PostgreSQL regression ABI:', release)
JS
mkdir -p packages/{pglite,pglite-tools}/release
ln -s ../dist/{postmaster,pglite}.wasm packages/pglite/release/
cp /sdk/classic/bin/*.{js,wasm} packages/pglite-tools/release/
PGLITE_PG_CONFIG_HEADER=/sdk/postmaster/pg_config.h node22 tools/wasm-multi-memory/generate-artifact-metadata.mjs
pnpm --filter @electric-sql/pg-protocol --filter @electric-sql/pglite-utils build
for package in pglite-server pglite-tools pglite-cli; do pnpm -C "packages/$package" build; done
bash tests/cli/pack-distribution.sh "$PWD" /postgres-test/distribution /packages/electric-sql-pglite-[0-9]*.tgz
mkdir -p /build/postmaster-test/{artifact,source-build/bin,icu}
ln -s /regression/runtime/postmaster.wasm /build/postmaster-test/artifact/
for suffix in js data; do
  ln -s "/regression/runtime/postmaster.$suffix" "/build/postmaster-test/source-build/bin/pglite.$suffix"
done
tar xf packages/pglite-icu-full/static/icu.76.tgz -C /build/postmaster-test/icu
chown 1000:1000 /postgres-test /postgres-test/native
