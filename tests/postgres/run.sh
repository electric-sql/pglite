#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?main PGlite repository root is required}
POSTMASTER_TEST_ROOT="${REPO_ROOT}/tests/postmaster"
POSTGRES_TEST_ROOT="${REPO_ROOT}/tests/postgres"
POSTMASTER_TEST=/postmaster-test
OUT=/postgres-test
NATIVE="${OUT}/native"
TARGET=${PGLITE_POSTGRES_TEST_TARGET:-check}
JOBS=${PGLITE_POSTGRES_TEST_JOBS:-2}
MAX_CONNECTIONS=${PGLITE_POSTGRES_TEST_MAX_CONNECTIONS:-4}

test -f /.dockerenv || {
  echo 'PostgreSQL regression tests must run inside the pinned Docker image' >&2
  exit 1
}
test "$(uname -m)" = aarch64
[[ "${JOBS}" =~ ^[1-9][0-9]*$ ]] || {
  echo "invalid PostgreSQL test parallel job count: ${JOBS}" >&2
  exit 1
}
[[ "${MAX_CONNECTIONS}" =~ ^[1-9][0-9]*$ ]] || {
  echo "invalid PostgreSQL test connection limit: ${MAX_CONNECTIONS}" >&2
  exit 1
}
export PGLITE_POSTGRES_TEST_JOBS="${JOBS}"
export PGLITE_POSTGRES_TEST_MAX_CONNECTIONS="${MAX_CONNECTIONS}"
export PGLITE_POSTGRES_TEST_TARGET="${TARGET}"
perl -MIPC::Run -e 'print "PostgreSQL TAP dependency: PASS\n"'
test -f "${POSTMASTER_TEST}/artifact/postmaster.wasm"
test -f "${POSTMASTER_TEST}/source-build/bin/pglite.js"
test -f "${POSTMASTER_TEST}/source-build/bin/pglite.data"
test -d "${POSTMASTER_TEST}/icu"

PGLITE_BUILD_JOBS="${JOBS}" \
  "${POSTMASTER_TEST_ROOT}/build-native-regress-tools.sh" \
  "${REPO_ROOT}" "${NATIVE}"
pnpm -C "${REPO_ROOT}/packages/pglite" build >/tmp/pglite-postgres-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-pgvector" build \
  >/tmp/pglite-pgvector-postgres-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-postgis" build \
  >/tmp/pglite-postgis-postgres-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-server" build \
  >/tmp/pglite-server-postgres-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-tools" build \
  >/tmp/pglite-tools-postgres-test-build.log
pnpm -C "${REPO_ROOT}/packages/pglite-cli" build \
  >/tmp/pglite-cli-postgres-test-build.log
PGLITE_CLI=$("${REPO_ROOT}/tests/cli/pack-distribution.sh" \
  "${REPO_ROOT}" "${OUT}/distribution" | tail -n 1)
test -x "${PGLITE_CLI}"

PROVIDER=$(node22 "${POSTGRES_TEST_ROOT}/prepare-test-provider.mjs" \
  "${REPO_ROOT}" "${POSTMASTER_TEST}" "${OUT}" "${NATIVE}" \
  "${PGLITE_CLI}")
test "${PROVIDER}" = "${OUT}/provider"
export PGLITE_TEST_PROVIDER="${PROVIDER}"
export PATH="${PROVIDER}/bin:${NATIVE}/build/src/bin/psql:${PATH}"
export LD_LIBRARY_PATH="${NATIVE}/build/src/interfaces/libpq${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export PGCTLTIMEOUT=${PGCTLTIMEOUT:-120}

rm -rf "${OUT}/results/raw-${TARGET}" "${OUT}/results/${TARGET}.log"
mkdir -p "${OUT}/results/raw-${TARGET}"
"${POSTGRES_TEST_ROOT}/provider-lifecycle.test.sh" \
  "${PROVIDER}" "${OUT}/results/raw-${TARGET}"
if [ "${PGLITE_POSTGRES_TEST_LIFECYCLE_ONLY:-false}" = true ]; then
  echo 'PGlite PostgreSQL test-provider lifecycle-only gate: PASS'
  exit 0
fi
set +e
MAKE_OPTIONS=(-C "${NATIVE}/build" -j"${JOBS}")
if [ "${TARGET}" = check-world ]; then
  MAKE_OPTIONS+=(-k)
fi
make "${MAKE_OPTIONS[@]}" "${TARGET}" \
  MAX_CONNECTIONS="${MAX_CONNECTIONS}" \
  PGLITE_TEST_CAPABILITY_RUNNER="${PROVIDER}/bin/pglite-test-capability" \
  PROVE="${PROVIDER}/bin/prove" \
  2>&1 | tee "${OUT}/results/${TARGET}.log"
STATUS=${PIPESTATUS[0]}
set -e

node22 "${POSTGRES_TEST_ROOT}/summarize-postgres-tests.mjs" \
  "${REPO_ROOT}" "${OUT}" "${TARGET}" "${STATUS}"
test "${STATUS}" -eq 0
echo "PGlite PostgreSQL ${TARGET} provider tests: PASS"
