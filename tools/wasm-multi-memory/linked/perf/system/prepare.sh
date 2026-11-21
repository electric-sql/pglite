#!/usr/bin/env bash
# Inside the linked SDK image. /stock is a built stock checkout at the same gitlink.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
root=/work/tools/wasm-multi-memory/linked
mkdir -p /bench/{deps,stock,linked} /out/{packages/stock,modules,archives}
addon=$(realpath /build/workspace/packages/pglite/node_modules/fs-ext-extra-prebuilt)
(cd "$addon" && npm pack --silent --ignore-scripts --pack-destination /bench/deps)
(cd "$(realpath "$(dirname "$addon")/nan")" && npm pack --silent --ignore-scripts --pack-destination /bench/deps)
mkdir -p /bench/ref/packages
cp /work/tsconfig.json /bench/ref/
ln -sfn /build/workspace/node_modules /bench/ref/node_modules
export PATH="/bench/ref/node_modules/.bin:$PATH"
for name in pglite pglite-pgvector pglite-postgis; do
  rm -rf "/bench/ref/packages/$name"
  mkdir -p "/bench/ref/packages/$name"
  (cd "/stock/packages/$name" && tar cf - --exclude=node_modules --exclude=dist .) | tar xf - -C "/bench/ref/packages/$name"
done
core=/bench/ref/packages/pglite
cp /out/reference/classic/{initdb.*,pglite.*} /out/reference/postmaster/postmaster.{js,data,wasm} "$core/release/"
ln -sfn /build/workspace/packages/pglite/node_modules "$core/node_modules"
bash "$root/perf/system/rebuild-core.sh" "$core"
for name in vector postgis; do
  dir=/bench/$name
  rm -rf "$dir"
  mkdir -p "$dir" "/out/modules/$name"
  tar xf "/sdk/classic/extensions/other/$name.tar.gz" -C "$dir"
  pglite-package-extension "/sdk/configs/$name.json" "$dir" "/out/archives/$name.wasm32-classic.tar.gz" "/out/archives/$name.wasm32-classic.json"
  pkg="$name"
  if [[ $name == vector ]]; then pkg=pgvector; fi
  # The native C build uses shared memory and compiles its atomics for that target.
  # Its shipped intermediate has already undergone the first provenance and -O3 passes.
  rm -rf "$dir"
  mkdir "$dir"
  tar xf "/stock/packages/pglite-$pkg/release/$name.wasm32-multi-memory.tar.gz" -C "$dir"
  rm -rf "$dir/.pglite"
  while IFS= read -r file; do
    ir="/out/modules/$name/$(basename "$file").native-domain.wasm"
    /opt/pglite-linked/version-loops "$file" "$ir" --mixed
    wasm-opt --all-features -O3 "$ir" -o "$file"
  done < <(find "$dir" -name '*.so' | sort)
  config="/work/packages/pglite-$pkg/extension-artifacts/wasm32-multi-memory.json"
  pglite-package-extension "$config" "$dir" "/out/archives/$name.wasm32-multi-memory.tar.gz" "/out/archives/$name.wasm32-multi-memory.json"
  # Keep the stock package layout, including its legacy archive. Rebuild its public descriptor.
  ext="/bench/ref/packages/pglite-$pkg"
  cp /out/archives/"$name".wasm32-* "$ext/release/"
  cp "/sdk/classic/extensions/other/$name.tar.gz" "$ext/release/$name.tar.gz"
  node22 /work/tools/wasm-multi-memory/extensions/generate-wrapper.mjs "$ext/src/generated-artifacts.ts" \
    "wasm32-classic=$ext/release/$name.wasm32-classic.json=../release/$name.wasm32-classic.tar.gz" \
    "wasm32-multi-memory=$ext/release/$name.wasm32-multi-memory.json=../release/$name.wasm32-multi-memory.tar.gz"
  ln -s "/build/workspace/packages/pglite-$pkg/node_modules" "$ext/node_modules"
  pnpm -C "$ext" build
done
for name in pglite pglite-pgvector pglite-postgis; do
  version=$(node22 -p "require('/bench/ref/packages/$name/package.json').version")
  # The SDK's packed manifest carries the published versions of workspace dependencies.
  tar xOf "/sdk/packages/electric-sql-$name-$version.tgz" package/package.json >"/bench/ref/packages/$name/package.json"
  (cd "/bench/ref/packages/$name" && npm pack --silent --ignore-scripts --pack-destination /out/packages/stock)
done
for mode in stock linked; do
  cd "/bench/$mode"
  rm -rf node_modules package-lock.json
  echo '{"private":true,"type":"module"}' >package.json
  src=/out/packages/stock
  if [[ $mode == linked ]]; then src=/sdk/packages; fi
  npm install --offline --ignore-scripts --no-audit --no-fund /bench/deps/*.tgz "$src"/electric-sql-pglite-{0*,pgvector-*,postgis-*}.tgz
done
