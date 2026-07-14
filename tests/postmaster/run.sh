#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?main PGlite repository root is required}
MM_ROOT="${REPO_ROOT}/tools/wasm-multi-memory"
PGLITE_INTEGRATION="${REPO_ROOT}/packages/pglite/integration-tests/postmaster"
SERVER_INTEGRATION="${REPO_ROOT}/packages/pglite-server/integration-tests"
OUT=/postmaster-test
POSTMASTER_BUILD=/postmaster-build
SOURCE_OUT="${OUT}/source-build"
ARTIFACT_OUT="${OUT}/artifact"
NATIVE="${OUT}/native"
TESTLIB="${OUT}/testlib"
DYNAMIC="${OUT}/dynamic"
PGDATA="${OUT}/pgdata"
RESULTS="${OUT}/regression"
ISOLATION_RESULTS="${OUT}/isolation"
READY="${OUT}/server-ready.json"
SERVER_RESULT="${OUT}/server-result.json"
SERVER_LOG="${OUT}/server.log"
PORT=${PGLITE_POSTMASTER_TEST_PORT:-55436}

test -f /.dockerenv || {
  echo 'Postmaster tests must run inside the pinned Docker image' >&2
  exit 1
}
test "$(uname -m)" = aarch64
test -f "${POSTMASTER_BUILD}/source-build/extensions/spi.tar.gz"

if [[ "${PGLITE_POSTMASTER_TEST_REUSE_ARTIFACT:-false}" != true ]]; then
  rm -rf "${ARTIFACT_OUT}"
  if [[ "${PGLITE_POSTMASTER_TEST_REUSE_SOURCE:-false}" != true ]]; then
    rm -rf "${SOURCE_OUT}"
    cp -a "${POSTMASTER_BUILD}/source-build" "${SOURCE_OUT}"
  else
    echo 'Reusing the existing configured postmaster source build'
    test -f "${SOURCE_OUT}/bin/pglite.js"
  fi
  (
    cd "${REPO_ROOT}/postgres-pglite"
    DEBUG=false \
    PGLITE_INCREMENTAL=true \
    PGLITE_BACKEND_ONLY=true \
    PGLITE_CLEAN_BACKEND=true \
    PGLITE_SHARED_MEMORY=true \
    PGLITE_MULTI_MEMORY_PROVENANCE=true \
    PGLITE_POSTMASTER=true \
    PGLITE_WITH_REGRESSION_TESTS=true \
    PGLITE_SKIP_THIRD_PARTY_EXTENSIONS=true \
    PGLITE_BUILD_JOBS=4 \
    INSTALL_FOLDER="${SOURCE_OUT}" \
      ./build-pglite.sh
  )
  LLVM_NM_BIN=${LLVM_NM:-/emsdk/upstream/bin/llvm-nm}
  TIMESTAMP_SYMBOLS=$(
    "${LLVM_NM_BIN}" \
      "${REPO_ROOT}/postgres-pglite/src/backend/utils/adt/timestamp.o"
  )
  grep -Eq ' U pgl_gettimeofday$' <<<"${TIMESTAMP_SYMBOLS}" || {
    echo 'Postmaster timestamp object bypasses the PGlite libc clock' >&2
    exit 1
  }
  if grep -Eq ' U gettimeofday$' <<<"${TIMESTAMP_SYMBOLS}"; then
    echo 'Postmaster timestamp object retained Emscripten gettimeofday' >&2
    exit 1
  fi
  PGLITE_POSTMASTER_BUILD_INNER_OUT="${ARTIFACT_OUT}" \
  PGLITE_POSTMASTER_BUILD_SOURCE_OUT="${SOURCE_OUT}" \
    "${REPO_ROOT}/tests/postmaster/build-artifact.sh" "${REPO_ROOT}"
else
  echo 'Reusing the existing regression-enabled postmaster artifact'
fi
test -f "${ARTIFACT_OUT}/postmaster.wasm"
test -f "${SOURCE_OUT}/bin/pglite.js"
test -f "${SOURCE_OUT}/bin/pglite.data"
test -f "${SOURCE_OUT}/lib/postgresql/regress.so"

rm -rf "${DYNAMIC}"
mkdir -p "${DYNAMIC}"
emcc -O2 -Wall -Wextra -Werror -Wno-unused-function \
  -fPIC -m32 -sWASM_BIGINT -sSIDE_MODULE=1 \
  -sSHARED_MEMORY=1 -sSUPPORT_LONGJMP=emscripten \
  -matomics -mbulk-memory \
  -D__PGLITE__ -D__PGLITE_MULTI_MEMORY__ -D__PGLITE_POSTMASTER__ \
  -I"${SOURCE_OUT}/include/postgresql/server" \
  -I"${REPO_ROOT}/postgres-pglite/pglite/src/pglitec" \
  -include "${REPO_ROOT}/postgres-pglite/pglite/src/pglitec/pglitec.h" \
  -Dshmget=pgl_shmget -Dshmat=pgl_shmat \
  -Dshmdt=pgl_shmdt -Dshmctl=pgl_shmctl \
  "${PGLITE_INTEGRATION}/fixtures/dynamic-probe.c" \
  -o "${DYNAMIC}/pglite_dynamic_probe.raw.so"
command -v pglite-transform-side-module >/dev/null
pglite-transform-side-module \
  "${DYNAMIC}/pglite_dynamic_probe.raw.so" \
  "${DYNAMIC}/pglite_dynamic_probe.so" \
  "${DYNAMIC}/pglite_dynamic_probe.report.json" \
  "${DYNAMIC}/pglite_dynamic_probe.audit.json"

"${REPO_ROOT}/tests/postmaster/build-native-regress-tools.sh" \
  "${REPO_ROOT}" "${NATIVE}"
cc -O2 -Wall -Wextra -Werror \
  -I"${NATIVE}/build/src/include" \
  -I"${NATIVE}/source/src/include" \
  -I"${NATIVE}/source/src/interfaces/libpq" \
  "${SERVER_INTEGRATION}/fixtures/native-client-test.c" \
  -L"${NATIVE}/build/src/interfaces/libpq" \
  -Wl,-rpath,"${NATIVE}/build/src/interfaces/libpq" \
  -lpq -pthread \
  -o "${OUT}/native-client-test"
pnpm -C "${REPO_ROOT}/packages/pglite" build >/tmp/pglite-postmaster-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-server" build \
  >/tmp/pglite-server-postmaster-test-build.log

PGLITE_POSTMASTER_INTEGRATION_CONFIG=$(node22 - \
  "${REPO_ROOT}" "${ARTIFACT_OUT}/postmaster.wasm" \
  "${SOURCE_OUT}/bin/pglite.js" "${SOURCE_OUT}/bin/pglite.data" \
  "${OUT}" "${NATIVE}" "${NATIVE}/build/src/bin/pgbench/pgbench" \
  "${DYNAMIC}/pglite_dynamic_probe.raw.so" \
  "${DYNAMIC}/pglite_dynamic_probe.so" \
  "${DYNAMIC}/pglite_dynamic_probe.audit.json" <<'NODE'
const [repoRoot, wasm, glue, data, outputRoot, nativeRoot, pgbench,
  raw, transformed, audit] = process.argv.slice(2)
process.stdout.write(JSON.stringify({
  repoRoot, wasm, glue, data, outputRoot, nativeRoot, pgbench,
  dynamic: { raw, transformed, audit },
}))
NODE
)
export PGLITE_POSTMASTER_INTEGRATION_CONFIG

pnpm -C "${REPO_ROOT}/packages/pglite" exec vitest run \
  integration-tests/postmaster/postmaster.integration.test.ts \
  --config integration-tests/postmaster/vitest.config.ts
pnpm -C "${REPO_ROOT}/packages/pglite-server" exec vitest run \
  integration-tests/socket.integration.test.ts \
  --config integration-tests/vitest.config.ts

rm -rf \
  "${TESTLIB}" "${PGDATA}" "${RESULTS}" "${ISOLATION_RESULTS}" \
  "${OUT}/spi" "${OUT}/icu" \
  "${READY}" "${SERVER_RESULT}" "${SERVER_LOG}"
mkdir -p \
  "${TESTLIB}" "${RESULTS}" "${ISOLATION_RESULTS}" \
  "${OUT}/spi" "${OUT}/icu"
cp "${SOURCE_OUT}/lib/postgresql/regress.so" \
  "${TESTLIB}/regress.so"
tar -xzf "${POSTMASTER_BUILD}/source-build/extensions/spi.tar.gz" -C "${OUT}/spi"
tar -xzf "${REPO_ROOT}/packages/pglite-icu-full/static/icu.76.tgz" \
  -C "${OUT}/icu"
cp "${OUT}/spi/lib/postgresql/"*.so "${TESTLIB}/"

SERVER_PID=
cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

node22 "${REPO_ROOT}/tests/postmaster/regression-server.mjs" \
  "${REPO_ROOT}" \
  "${ARTIFACT_OUT}/postmaster.wasm" \
  "${SOURCE_OUT}/bin/pglite.js" \
  "${SOURCE_OUT}/bin/pglite.data" \
  "${NATIVE}" \
  "${TESTLIB}" \
  "${OUT}" \
  "${PGDATA}" \
  "${READY}" \
  "${SERVER_RESULT}" \
  "${PORT}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 240); do
  [[ -f "${READY}" ]] && break
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    cat "${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 0.25
done
test -f "${READY}" || {
  cat "${SERVER_LOG}" >&2
  echo 'Postmaster regression server did not become ready' >&2
  exit 1
}

export LD_LIBRARY_PATH="${NATIVE}/build/src/interfaces/libpq${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export PGHOST=127.0.0.1
export PGPORT="${PORT}"
export PGUSER=postgres
export PGSSLMODE=disable
export PGCONNECT_TIMEOUT=30

REGRESS_SELECTION=(
  --schedule="${NATIVE}/source/src/test/regress/parallel_schedule"
)
if [[ -n "${PGLITE_POSTMASTER_TEST_REGRESS_TESTS:-}" ]]; then
  read -r -a REGRESS_SELECTION <<<"${PGLITE_POSTMASTER_TEST_REGRESS_TESTS}"
fi

"${OUT}/native-client-test" \
  "host=${PGHOST} port=${PGPORT} user=${PGUSER} dbname=regression sslmode=disable" \
  | tee "${OUT}/native-client.log"

"${NATIVE}/build/src/test/regress/pg_regress" \
  --use-existing \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --user="${PGUSER}" \
  --dbname=regression \
  --bindir="${NATIVE}/build/src/bin/psql" \
  --inputdir="${NATIVE}/source/src/test/regress" \
  --expecteddir="${NATIVE}/source/src/test/regress" \
  --outputdir="${RESULTS}" \
  --dlpath="${TESTLIB}" \
  --max-concurrent-tests=20 \
  "${REGRESS_SELECTION[@]}"

if [[ -n "${PGLITE_POSTMASTER_TEST_REGRESS_TESTS:-}" ]]; then
  kill -TERM "${SERVER_PID}"
  wait "${SERVER_PID}"
  SERVER_PID=
  test -f "${SERVER_RESULT}"
  echo "PGlite postmaster targeted regression tests: PASS (${PGLITE_POSTMASTER_TEST_REGRESS_TESTS})"
  exit 0
fi

"${NATIVE}/build/src/test/isolation/pg_isolation_regress" \
  --use-existing \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --user="${PGUSER}" \
  --dbname=isolation_regression \
  --bindir="${NATIVE}/build/src/bin/psql" \
  --inputdir="${NATIVE}/source/src/test/isolation" \
  --expecteddir="${NATIVE}/source/src/test/isolation" \
  --outputdir="${ISOLATION_RESULTS}" \
  --schedule="${NATIVE}/source/src/test/isolation/isolation_schedule"

kill -TERM "${SERVER_PID}"
wait "${SERVER_PID}"
SERVER_PID=
test -f "${SERVER_RESULT}"

echo 'PGlite postmaster core regression and isolation tests: PASS'

pnpm -C "${REPO_ROOT}/packages/pglite" exec vitest run \
  integration-tests/postmaster/postmaster.stress.test.ts \
  --config integration-tests/postmaster/vitest.config.ts
