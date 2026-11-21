#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT=$1
OUT=$2
NATIVE=$3
WASM=$4
GLUE=$5
DATA=$6
PORT=${PGLITE_POSTMASTER_TEST_PORT:-55436}
TESTLIB=$OUT/testlib
PGDATA=$OUT/pgdata
READY=$OUT/server-ready.json
SERVER_RESULT=$OUT/server-result.json
SERVER_LOG=$OUT/server.log
RESULTS=$OUT/regression
ISOLATION_RESULTS=$OUT/isolation
mkdir -p "$RESULTS" "$ISOLATION_RESULTS"
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
  "$WASM" \
  "$GLUE" \
  "$DATA" \
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

if [[ -x "${OUT}/native-client-test" ]]; then
  "${OUT}/native-client-test" \
  "host=${PGHOST} port=${PGPORT} user=${PGUSER} dbname=regression sslmode=disable" \
  | tee "${OUT}/native-client.log"
fi

core_status=0
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
  "${REGRESS_SELECTION[@]}" || core_status=$?

if [[ -n "${PGLITE_POSTMASTER_TEST_REGRESS_TESTS:-}" ]]; then
  kill -TERM "${SERVER_PID}"
  wait "${SERVER_PID}"
  SERVER_PID=
  test -f "${SERVER_RESULT}"
  test "$core_status" = 0
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

test "$core_status" = 0
echo 'PGlite postmaster core regression and isolation tests: PASS'

