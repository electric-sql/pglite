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
NATIVE=${PGLITE_NATIVE_TEST_ROOT:-${OUT}/native}
TESTLIB="${OUT}/testlib"
DYNAMIC="${OUT}/dynamic"
WORKER_SPI="${OUT}/worker-spi-extension"
TEST_DSA_EXTENSION="${OUT}/test-dsa-extension"
PGDATA="${OUT}/pgdata"
RESULTS="${OUT}/regression"
ISOLATION_RESULTS="${OUT}/isolation"
READY="${OUT}/server-ready.json"
SERVER_RESULT="${OUT}/server-result.json"
SERVER_LOG="${OUT}/server.log"

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
    PGLITE_CLEAN_BACKEND="${PGLITE_POSTMASTER_TEST_CLEAN_BACKEND:-true}" \
    PGLITE_SHARED_MEMORY=true \
    PGLITE_MULTI_MEMORY_PROVENANCE=true \
    PGLITE_POSTMASTER=true \
    PGLITE_RUNTIME_SIDE_MODULE_POSTPROCESSOR=pglite-transform-runtime-modules \
    PGLITE_RUNTIME_SIDE_MODULE_REPORT_ROOT="${OUT}/runtime-modules" \
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

"${REPO_ROOT}/tests/postmaster/build-dynamic-fixtures.sh" \
  "${REPO_ROOT}" "${SOURCE_OUT}" "${DYNAMIC}"

# The regression artifact statically registers worker_spi. Package its normal
# control/SQL layout behind an extension descriptor so this gate exercises the
# production shared-preload aggregation before proving static and dynamic
# background Worker startup. Use the test module produced by the same build
# instead of an empty placeholder: artifact packaging deliberately rejects
# malformed Wasm even when the test-only static registry will claim the path
# before the dynamic loader.
rm -rf "${WORKER_SPI}"
mkdir -p \
  "${WORKER_SPI}/root/share/postgresql/extension" \
  "${WORKER_SPI}/root/lib/postgresql"
cp "${REPO_ROOT}/postgres-pglite/src/test/modules/worker_spi/worker_spi.control" \
  "${REPO_ROOT}/postgres-pglite/src/test/modules/worker_spi/worker_spi--1.0.sql" \
  "${WORKER_SPI}/root/share/postgresql/extension/"
cp "${REPO_ROOT}/postgres-pglite/src/test/modules/worker_spi/worker_spi.so" \
  "${WORKER_SPI}/root/lib/postgresql/worker_spi.so"
node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/package-extension.mjs" \
  "${REPO_ROOT}/tests/postmaster/fixtures/worker-spi-extension.json" \
  "${WORKER_SPI}/root" \
  "${WORKER_SPI}/worker_spi.tar.gz" \
  "${WORKER_SPI}/worker_spi.json"

# The regression build links test_dsa statically, but its control and SQL
# files are not part of the production data archive inherited by this test
# artifact. Package that normal extension layout explicitly for the stress
# gate that exercises DSM/DSA reclamation.
rm -rf "${TEST_DSA_EXTENSION}"
mkdir -p \
  "${TEST_DSA_EXTENSION}/root/share/postgresql/extension" \
  "${TEST_DSA_EXTENSION}/root/lib/postgresql"
cp "${REPO_ROOT}/postgres-pglite/src/test/modules/test_dsa/test_dsa.control" \
  "${REPO_ROOT}/postgres-pglite/src/test/modules/test_dsa/test_dsa--1.0.sql" \
  "${TEST_DSA_EXTENSION}/root/share/postgresql/extension/"
cp "${REPO_ROOT}/postgres-pglite/src/test/modules/test_dsa/test_dsa.so" \
  "${TEST_DSA_EXTENSION}/root/lib/postgresql/test_dsa.so"
node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/package-extension.mjs" \
  "${REPO_ROOT}/tests/postmaster/fixtures/test-dsa-extension.json" \
  "${TEST_DSA_EXTENSION}/root" \
  "${TEST_DSA_EXTENSION}/test_dsa.tar.gz" \
  "${TEST_DSA_EXTENSION}/test_dsa.json"

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
pnpm -C "${REPO_ROOT}/packages/pglite-pgvector" build \
  >/tmp/pglite-pgvector-postmaster-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-postgis" build \
  >/tmp/pglite-postgis-postmaster-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-server" build \
  >/tmp/pglite-server-postmaster-test-build.log

PGLITE_POSTMASTER_INTEGRATION_CONFIG=$(node22 - \
  "${REPO_ROOT}" "${ARTIFACT_OUT}/postmaster.wasm" \
  "${SOURCE_OUT}/bin/pglite.js" "${SOURCE_OUT}/bin/pglite.data" \
  "${OUT}" "${NATIVE}" "${NATIVE}/build/src/bin/pgbench/pgbench" \
  "${DYNAMIC}/pglite_dynamic_probe.raw.so" \
  "${DYNAMIC}/pglite_dynamic_probe.so" \
  "${DYNAMIC}/pglite_dynamic_probe.audit.json" \
  "${WORKER_SPI}/worker_spi.tar.gz" \
  "${WORKER_SPI}/worker_spi.json" \
  "${TEST_DSA_EXTENSION}/test_dsa.tar.gz" \
  "${TEST_DSA_EXTENSION}/test_dsa.json" <<'NODE'
const [repoRoot, wasm, glue, data, outputRoot, nativeRoot, pgbench,
  raw, transformed, audit, workerSpiArchive, workerSpiDescriptor,
  testDsaArchive, testDsaDescriptor] = process.argv.slice(2)
process.stdout.write(JSON.stringify({
  repoRoot, wasm, glue, data, outputRoot, nativeRoot, pgbench,
  dynamic: { raw, transformed, audit },
  workerSpi: { archive: workerSpiArchive, descriptor: workerSpiDescriptor },
  testDsa: { archive: testDsaArchive, descriptor: testDsaDescriptor },
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

bash "${REPO_ROOT}/tests/postmaster/run-schedules.sh" "$REPO_ROOT" "$OUT" "$NATIVE" \
  "$ARTIFACT_OUT/postmaster.wasm" "$SOURCE_OUT/bin/pglite.js" "$SOURCE_OUT/bin/pglite.data"
if [[ -n "${PGLITE_POSTMASTER_TEST_REGRESS_TESTS:-}" ]]; then exit 0; fi

pnpm -C "${REPO_ROOT}/packages/pglite" exec vitest run \
  integration-tests/postmaster/postmaster.stress.test.ts \
  --config integration-tests/postmaster/vitest.config.ts
