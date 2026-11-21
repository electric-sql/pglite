#!/usr/bin/env bash
# Recreate the build workspace from source and the step 3 release tarballs.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
sdk=tools/wasm-multi-memory/linked/sdk
bash "/work/$sdk/workspace.sh"
cd /build/workspace
pnpm --filter @electric-sql/pg-protocol --filter @electric-sql/pglite-utils build
node22 "$sdk/catalog.mjs" wrappers /sdk
core=packages/pglite
tar xf /sdk/packages/electric-sql-pglite-0*.tgz -C "$core" --strip-components=1 package/dist
cp /sdk/classic/bin/{initdb.*,pglite.*} "$core/release/"
cp "$core"/dist/{postmaster.*,linked-*.wasm,runtime-identity.json,*.tar.gz} "$core/release/"
# pnpm normalizes modes in the tarball. Restore the SDK build-product modes for npm pack.
for suffix in data js wasm; do
  chmod --reference="/sdk/postmaster/bin/pglite.$suffix" "$core/release/postmaster.$suffix"
done
ext=packages/pglite-pgvector
cp /sdk/extensions/vector.{json,tar.gz} "$ext/release/"
tar xOf /sdk/packages/*pgvector*.tgz package/dist/PGVECTOR-LICENSE >"$ext/release/PGVECTOR-LICENSE"
