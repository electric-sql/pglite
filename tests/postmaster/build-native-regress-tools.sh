#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?main PGlite repository root is required}
OUT=${2:?native output directory is required}
PG_ROOT="${REPO_ROOT}/postgres-pglite"
SOURCE="${OUT}/source"
BUILD="${OUT}/build"
INSTALL="${OUT}/install"
JOBS=${PGLITE_BUILD_JOBS:-4}

ARCHITECTURE=$(uname -m)
case "${ARCHITECTURE}" in
  aarch64) HOST_PLATFORM=linux/arm64 ;;
  x86_64) HOST_PLATFORM=linux/amd64 ;;
  *)
    echo "unsupported native regression-tool architecture: ${ARCHITECTURE}" >&2
    exit 1
    ;;
esac

test -f /.dockerenv || {
  echo 'native PostgreSQL regression tools must be built inside the pinned Docker image' >&2
  exit 1
}

REVISION=$(git -C "${PG_ROOT}" rev-parse HEAD)
if [[ -f "${OUT}/manifest.json" && \
      -x "${BUILD}/src/test/regress/pg_regress" && \
      -x "${BUILD}/src/test/isolation/pg_isolation_regress" && \
      -x "${BUILD}/src/test/isolation/isolationtester" && \
      -x "${BUILD}/src/bin/psql/psql" && \
      -x "${BUILD}/src/bin/scripts/pg_isready" && \
      -x "${BUILD}/src/bin/pgbench/pgbench" && \
      -x "${BUILD}/src/bin/pg_ctl/pg_ctl" && \
      -x "${BUILD}/src/bin/initdb/initdb" && \
      -x "${BUILD}/src/backend/postgres" && \
      -x "${INSTALL}/bin/postgres" && \
      -f "${BUILD}/src/test/perl/Makefile" && \
      -f "${BUILD}/contrib/dist.mk" && \
      -f "${SOURCE}/src/test/regress/parallel_schedule" ]] && \
   node22 - "${OUT}/manifest.json" "${REVISION}" \
     "${HOST_PLATFORM}" "${ARCHITECTURE}" <<'NODE'
const fs = require('node:fs')
const [manifestPath, revision, host, architecture] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
process.exit(
  manifest.status === 'pass' &&
    manifest.revision === revision &&
    manifest.host === host &&
    manifest.architecture === architecture &&
    manifest.execBackendCompatibility === true &&
    manifest.wasm32WalCompatibility === true
    ? 0
    : 1,
)
NODE
then
  export LD_LIBRARY_PATH="${BUILD}/src/interfaces/libpq${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
  test "$(uname -m)" = "${ARCHITECTURE}"
  test "$("${BUILD}/src/test/regress/pg_regress" --version)" = \
    'pg_regress (PostgreSQL) 18.3'
  test "$("${BUILD}/src/test/isolation/pg_isolation_regress" --version)" = \
    'pg_regress (PostgreSQL) 18.3'
  test "$("${BUILD}/src/bin/psql/psql" --version)" = \
    'psql (PostgreSQL) 18.3'
  test "$("${BUILD}/src/bin/scripts/pg_isready" --version)" = \
    'pg_isready (PostgreSQL) 18.3'
  test "$("${BUILD}/src/bin/pgbench/pgbench" --version)" = \
    'pgbench (PostgreSQL) 18.3'
  echo "Reusing exact-revision native ${HOST_PLATFORM} PostgreSQL regression tools"
  exit 0
fi

rm -rf "${SOURCE}" "${BUILD}" "${INSTALL}" "${OUT}/manifest.json"
mkdir -p "${SOURCE}" "${BUILD}" "${INSTALL}"

# The main source checkout is configured in-place for Emscripten, so its
# generated pg_config.h must not leak into this native build. A clean archive
# also pins the host tools and regression inputs to one exact PostgreSQL fork
# commit.
git -C "${PG_ROOT}" archive --format=tar "${REVISION}" \
  | tar -xf - -C "${SOURCE}"

(
  cd "${BUILD}"
  CPPFLAGS='-DEXEC_BACKEND -DPGLITE_WASM32_WAL' "${SOURCE}/configure" \
    --prefix="${INSTALL}" \
    --without-icu \
    --without-readline \
    --without-zlib \
    --enable-tap-tests
)

# PGlite's contrib/Makefile adds an in-tree packaging include. Keep this
# native-test compatibility fence here instead of changing PostgreSQL source.
ln -s "${SOURCE}/contrib/dist.mk" "${BUILD}/contrib/dist.mk"

make -j"${JOBS}" -C "${BUILD}" all
make -C "${BUILD}" install

export LD_LIBRARY_PATH="${BUILD}/src/interfaces/libpq${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
test "$("${BUILD}/src/test/regress/pg_regress" --version)" = \
  'pg_regress (PostgreSQL) 18.3'
test "$("${BUILD}/src/test/isolation/pg_isolation_regress" --version)" = \
  'pg_regress (PostgreSQL) 18.3'
test "$("${BUILD}/src/bin/psql/psql" --version)" = \
  'psql (PostgreSQL) 18.3'
test "$("${BUILD}/src/bin/scripts/pg_isready" --version)" = \
  'pg_isready (PostgreSQL) 18.3'
test "$("${BUILD}/src/bin/pgbench/pgbench" --version)" = \
  'pgbench (PostgreSQL) 18.3'
test "$(uname -m)" = "${ARCHITECTURE}"

node22 - "${OUT}/manifest.json" "${REVISION}" \
  "${HOST_PLATFORM}" "${ARCHITECTURE}" <<'NODE'
const fs = require('node:fs')
const [output, revision, host, architecture] = process.argv.slice(2)
fs.writeFileSync(output, `${JSON.stringify({
  schema: 1,
  status: 'pass',
  revision,
  postgresql: '18.3',
  host,
  architecture,
  execBackendCompatibility: true,
  wasm32WalCompatibility: true,
  tools: [
    'libpq',
    'psql',
    'pg_isready',
    'pgbench',
    'pg_regress',
    'pg_isolation_regress',
    'isolationtester',
    'createdb',
    'dropdb',
    'initdb',
    'postgres',
    'pg_ctl',
    'pg_dump',
    'pg_restore',
    'pg_basebackup',
    'pg_controldata',
    'pg_resetwal',
    'pg_rewind',
    'TAP/Perl PostgreSQL::Test',
  ],
  sourceIsolation: 'git-archive',
}, null, 2)}\n`)
NODE
