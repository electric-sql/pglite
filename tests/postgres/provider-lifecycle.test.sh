#!/usr/bin/env bash
set -euo pipefail

PROVIDER=${1:?provider path is required}
RESULT_ROOT=${2:?result root is required}
PORT=${PGLITE_POSTGRES_TEST_LIFECYCLE_PORT:-65431}
ROOT=$(mktemp -d "${RESULT_ROOT}/lifecycle.XXXXXX")
PGDATA="${ROOT}/data"
SOCKET_DIR="${ROOT}/socket"
LOG="${ROOT}/postgres.log"
COPIED_STATE="${ROOT}/copied-provider-state.json"
CLONE_DATA="${ROOT}/clone-data"
CLONE_SOCKET_DIR="${ROOT}/clone-socket"
CLONE_LOG="${ROOT}/clone-postgres.log"
CLONE_PORT=$((PORT + 1))

mkdir -p "${SOCKET_DIR}" "${CLONE_SOCKET_DIR}"

cleanup() {
  "${PROVIDER}/bin/pg_ctl" -s -D "${PGDATA}" -m immediate stop \
    >/dev/null 2>&1 || true
  "${PROVIDER}/bin/pg_ctl" -s -D "${CLONE_DATA}" -m immediate stop \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

set +e
IO_METHOD_PROBE=$("${PROVIDER}/bin/postgres" -C invalid \
  -c io_method=invalid 2>&1)
IO_METHOD_STATUS=$?
set -e
test "${IO_METHOD_STATUS}" -eq 1
grep -q 'Available values: sync, worker' <<<"${IO_METHOD_PROBE}"

"${PROVIDER}/bin/initdb" -D "${PGDATA}" --auth=trust --no-sync \
  --no-instructions --data-checksums -c track_commit_timestamp=on
test "$("${PROVIDER}/bin/postgres" -D "${PGDATA}" -C data_checksums \
  -c log_min_messages=fatal)" = on
"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" -l "${LOG}" \
  -o "-F -k '${SOCKET_DIR}' -p ${PORT}" start
"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" status
"${PROVIDER}/bin/psql" -X -v ON_ERROR_STOP=1 -h "${SOCKET_DIR}" \
  -p "${PORT}" -d postgres -Atqc 'SELECT 41 + 1'
test "$("${PROVIDER}/bin/psql" -X -h "${SOCKET_DIR}" -p "${PORT}" \
  -d postgres -Atqc "SHOW track_commit_timestamp")" = on

printf '%s\n' 'log_min_messages = warning' >>"${PGDATA}/postgresql.conf"
"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" reload

"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" -l "${LOG}" -t 15 restart
"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" status
"${PROVIDER}/bin/psql" -X -v ON_ERROR_STOP=1 -h "${SOCKET_DIR}" \
  -p "${PORT}" -d postgres -Atqc \
  "SELECT current_setting('log_min_messages')"

# A physical backup can contain the source provider's live runtime marker.
# Prove that a cloned data directory discards that path-specific state rather
# than rejecting the clone or signalling the source process.
cp "${PGDATA}/.pglite-provider.json" "${COPIED_STATE}"

"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" -m fast stop
set +e
"${PROVIDER}/bin/pg_ctl" -D "${PGDATA}" status >/dev/null 2>&1
STATUS=$?
set -e
test "${STATUS}" -eq 3
test ! -e "${PGDATA}/.pglite-provider.json"
test ! -e "${PGDATA}/postmaster.pid"

cp -RPp "${PGDATA}" "${CLONE_DATA}"
cp "${COPIED_STATE}" "${CLONE_DATA}/.pglite-provider.json"
"${PROVIDER}/bin/pg_ctl" -D "${CLONE_DATA}" -l "${CLONE_LOG}" \
  -o "-F -k '${CLONE_SOCKET_DIR}' -p ${CLONE_PORT}" start
"${PROVIDER}/bin/psql" -X -v ON_ERROR_STOP=1 -h "${CLONE_SOCKET_DIR}" \
  -p "${CLONE_PORT}" -d postgres -Atqc 'SELECT 6 * 7'
"${PROVIDER}/bin/pg_ctl" -D "${CLONE_DATA}" -m fast stop
test ! -e "${CLONE_DATA}/.pglite-provider.json"
test ! -e "${CLONE_DATA}/postmaster.pid"
trap - EXIT

echo 'PGlite PostgreSQL test-provider lifecycle: PASS'
