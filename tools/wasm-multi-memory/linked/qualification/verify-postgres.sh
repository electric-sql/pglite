#!/usr/bin/env bash
set -euo pipefail
mode=$1
export PATH="/opt/node22/bin:$PATH" LD_LIBRARY_PATH=/native/build/src/interfaces/libpq
export PGLITE_LINKED_OUT=/sdk
phase=${2:-all}
case "$phase" in all|prepare|scenarios|schedules|stress) ;; *) exit 2;; esac
case "$mode" in linked|native) ;; *) exit 2;; esac
if [[ $phase == all || $phase == prepare ]]; then
  bash /work/tools/wasm-multi-memory/linked/sdk/workspace.sh
  cd /build/workspace
  root=$PWD
  core=packages/pglite/release
  mkdir -p "$core" packages/pglite-tools/release postgres-pglite/src/include/catalog
  cp /sdk/classic/bin/{pglite.*,initdb.*} /out/runtime/postmaster.* "$core/"
  cp /sdk/classic/extensions/*.tar.gz "$core/"
  cp /sdk/classic/bin/*.wasm packages/pglite-tools/release/
  cp /sdk/classic/include/postgresql/server/catalog/catversion.h postgres-pglite/src/include/catalog/
  if [[ $mode == linked ]]; then
    /emsdk/upstream/bin/llvm-objcopy --add-section pglite.linked-unshared=/opt/pglite-linked/linked-unshared.wasm \
      /sdk/classic/bin/pglite.wasm "$core/pglite.wasm"
    cp /opt/pglite-linked/linked-*.wasm "$core/"
  fi
  PGLITE_PG_CONFIG_HEADER=/sdk/postmaster/pg_config.h node22 tools/wasm-multi-memory/generate-artifact-metadata.mjs
  pnpm --filter @electric-sql/pglite-utils --filter @electric-sql/pg-protocol build
  pnpm -C packages/pglite build
  pnpm -C packages/pglite-server build
  mkdir -p /build/results/{icu,regression,isolation,testlib}
  cp /out/testlib/* /build/results/testlib/
  tar xf packages/pglite-icu-full/static/icu.76.tgz -C /build/results/icu
  for module in test_dsa worker_spi; do
    stage=$(mktemp -d)
    mkdir -p "$stage"/{lib/postgresql,share/postgresql/extension}
    cp "/out/fixtures/$module.so" "$stage/lib/postgresql/"
    cp "/native/source/src/test/modules/$module/"{"$module.control","$module--1.0.sql"} "$stage/share/postgresql/extension/"
    config=tests/postmaster/fixtures/${module//_/-}-extension.json
    if [[ $mode == linked ]]; then
      tar -czf "/tmp/$module.raw.tgz" -C "$stage" .
      pglite-linked-package "$config" "/tmp/$module.raw.tgz" "/out/$module.tgz" "/out/$module.json" /out/fixtures
    else
      pglite-package-extension "$config" "$stage" "/out/$module.tgz" "/out/$module.json"
    fi
  done
fi
cd /build/workspace
root=$PWD
dist=$root/packages/pglite/dist
artifacts=("$dist/postmaster.wasm" "$dist/postmaster.js" "$dist/postmaster.data")
scenarios=packages/pglite/integration-tests/postmaster/scenarios
if [[ $phase == prepare ]]; then exit 0; fi
if [[ $phase == all || $phase == scenarios ]]; then
  node22 "$scenarios/shared-memory-lifetime.mjs" "${artifacts[@]}"
  node22 "$scenarios/postmaster-correctness.mjs" "$root" "${artifacts[@]}" /out/correctness.json
  node22 "$scenarios/background-worker-extension.mjs" "$root" "${artifacts[@]}" /out/worker_spi.tgz /out/worker_spi.json
  node22 "$scenarios/cluster-ownership.mjs" "$root" "${artifacts[@]}" /out/cluster-ownership.json
  node22 "$scenarios/brokered-filesystem.mjs" "$root" "${artifacts[@]}"
fi
status=0
if [[ $phase == all || $phase == schedules ]]; then
  rm -rf /build/results/{pgdata,regression,isolation} /build/results/server-{ready,result}.json
  bash tests/postmaster/run-schedules.sh "$root" /build/results /native "${artifacts[@]}" || status=1
  rm -rf /out/{regression,isolation}
  cp -a /build/results/{regression,isolation,server*.log,server*.json} /out/ || status=1
fi
if [[ $phase == all || $phase == stress ]]; then
  node22 "$scenarios/postmaster-stress.mjs" "$root" "${artifacts[@]}" /native/build/src/bin/pgbench/pgbench \
    /build/results /out/stress.json /out/test_dsa.tgz /out/test_dsa.json || status=1
fi
exit "$status"
