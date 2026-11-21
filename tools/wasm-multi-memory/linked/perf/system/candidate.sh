#!/usr/bin/env bash
# Build an isolated paired-read extension and constant-offset PostgreSQL core in the SDK.
set -euo pipefail
export PATH="/build/workspace/node_modules/.bin:/opt/node22/bin:$PATH"
root=/work/tools/wasm-multi-memory/linked
src=/bench/compiler
mkdir -p "$src/tools/wasm-multi-memory/linked/perf/system" /out/packages/candidate /bench/trial/packages
cp "$root"/{compile.sh,version-loops.cpp,pair-loads.h,ordered-loads.h} "$src/tools/wasm-multi-memory/linked/"
cp "$root/perf/system/provider-immediates.cpp" "$src/tools/wasm-multi-memory/linked/perf/system/"
(cd "$src" && bash tools/wasm-multi-memory/linked/compile.sh version-loops perf/system/provider-immediates)
cp /work/tsconfig.json /bench/trial
ln -sfn /build/workspace/node_modules /bench/trial/node_modules
for name in pglite pglite-pgvector; do
  dir="/bench/trial/packages/$name"
  mkdir -p "$dir"
  (cd "/build/workspace/packages/$name" && tar cf - --exclude=node_modules --exclude=dist .) | tar xf - -C "$dir"
  ln -sfn "/build/workspace/packages/$name/node_modules" "$dir/node_modules"
done
core=/bench/trial/packages/pglite
control=/build/workspace/packages/pglite/release
"$src/build/linked/provider-immediates" "$control/postmaster.wasm" "$core/release/postmaster.wasm" \
  "$control/linked-shared.wasm" "$core/release/linked-shared.wasm" "$control/linked-unshared.wasm" "$core/release/linked-unshared.wasm"
bash "$root/perf/system/rebuild-core.sh" "$core"
dir=/bench/trial/vector-files
mkdir -p "$dir"
tar xf /sdk/classic/extensions/other/vector.tar.gz -C "$dir"
module="$dir/lib/postgresql/vector.so"
raw=$(sha256sum "$module" | cut -d' ' -f1)
pglite-wasm-multi-memory "$module" --output /bench/trial/domain.wasm --report /bench/trial/domain.json \
  --input-sha256 "$raw" --provenance --inline-private-fast-path --global-initial-pages 2 --global-maximum-pages 16384 \
  --enable-feature atomics --enable-feature mutable-globals --enable-feature sign-ext --enable-feature bulk-memory --enable-feature bulk-memory-opt
wasm-opt --all-features -O3 /bench/trial/domain.wasm -o /bench/trial/optimized.wasm
for kind in mixed pair-linked; do
  "$src/build/linked/version-loops" /bench/trial/optimized.wasm "/bench/trial/$kind.wasm" "--$kind" >"/out/$kind-codegen.log"
  /opt/pglite-linked/lower --sdk "/bench/trial/$kind.wasm" "/bench/trial/$kind.lowered.wasm"
  wasm-opt --all-features -O3 "/bench/trial/$kind.lowered.wasm" -o "/out/modules/vector/$kind.so"
done
expected=$(jq -r '.extensionManifest.sideModules[0].sha256' /sdk/extensions/vector.json)
echo "$expected  /out/modules/vector/mixed.so" | sha256sum -c -
grep -E 'vector_l2_squared_distance .*pairs=[1-9]' /out/pair-linked-codegen.log
cp /out/modules/vector/pair-linked.so "$module"
ext=/bench/trial/packages/pglite-pgvector
jq '.target.topology="faceted"|.target.memoryAbi="pglite-linked-wasm32-v1"' /sdk/configs/vector.json >/bench/trial/faceted.json
pglite-package-extension /bench/trial/faceted.json "$dir" "$ext/release/vector.tar.gz" "$ext/release/vector.json"
node22 /work/tools/wasm-multi-memory/extensions/generate-wrapper.mjs "$ext/src/generated-artifacts.ts" \
  "wasm32-faceted=$ext/release/vector.json=../release/vector.tar.gz"
pnpm -C "$ext" build
for name in pglite pglite-pgvector; do
  dir="/bench/trial/packages/$name"
  version=$(node22 -p "require('$dir/package.json').version")
  tar xOf "/sdk/packages/electric-sql-$name-$version.tgz" package/package.json >"$dir/package.json"
  (cd "$dir" && npm pack --silent --ignore-scripts --pack-destination /out/packages/candidate)
done
mkdir -p /bench/candidate
cd /bench/candidate
rm -rf node_modules package-lock.json
echo '{"type":"module","private":true}' >package.json
npm install --offline --ignore-scripts --no-audit --no-fund /bench/deps/*.tgz /out/packages/candidate/*.tgz /sdk/packages/*postgis*.tgz
node20 "$root/perf/check-domains.mjs" /out/modules/vector/{mixed,pair-linked}.so "$core/release" --check-mixed
node20 "$root/perf/check-domains.mjs" /out/modules/vector/{mixed,pair-linked}.so "$core/release" --check-pairs
node20 "$root/perf/system/check-providers.mjs" "$control" "$core/release"
