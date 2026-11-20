#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${1:?PGlite repository root is required}
SOURCE_OUT=${2:?installed PostgreSQL build is required}
DYNAMIC=${3:?fixture output directory is required}
PGLITE_INTEGRATION="${REPO_ROOT}/packages/pglite/integration-tests/postmaster"

rm -rf "${DYNAMIC}"
mkdir -p "${DYNAMIC}"
build_dynamic_module() {
  local compiler=$1
  local source=$2
  local module=$3
  shift 3
  PGLITE_MEMORY_PLACEMENT_REPORT_DIR="${DYNAMIC}/placement-reports" \
    "$compiler" -O2 -Wall -Wextra -Werror -Wno-unused-function -Wno-unused-parameter \
    -fPIC -m32 -sWASM_BIGINT -sSIDE_MODULE=1 \
    -sSHARED_MEMORY=1 -sSUPPORT_LONGJMP=emscripten \
    -matomics -mbulk-memory \
    -D__PGLITE__ -D__PGLITE_MULTI_MEMORY__ -D__PGLITE_POSTMASTER__ \
    -I"${SOURCE_OUT}/include/postgresql/server" \
    -I"${REPO_ROOT}/postgres-pglite/pglite/src/pglitec" \
    -iquote "${REPO_ROOT}/postgres-pglite/pglite/src/postgres-headers" \
    -include "${REPO_ROOT}/postgres-pglite/pglite/src/pglitec/pglitec.h" \
    -Dshmget=pgl_shmget -Dshmat=pgl_shmat \
    -Dshmdt=pgl_shmdt -Dshmctl=pgl_shmctl \
    "$@" "$source" -o "${DYNAMIC}/${module}.raw.so"
  pglite-transform-side-module \
    "${DYNAMIC}/${module}.raw.so" "${DYNAMIC}/${module}.so" \
    "${DYNAMIC}/${module}.report.json" "${DYNAMIC}/${module}.audit.json"
}
build_dynamic_module emcc "${PGLITE_INTEGRATION}/fixtures/dynamic-probe.c" pglite_dynamic_probe
for mode in global root; do
  compiler=emcc
  if [[ "$mode" = root ]]; then
    compiler="${REPO_ROOT}/postgres-pglite/pglite/tools/memory-placement/cc.mjs"
  fi
  build_dynamic_module "$compiler" \
    "${REPO_ROOT}/postgres-pglite/src/test/modules/test_dsa/test_dsa.c" "placement_${mode}" \
    "-Dtest_dsa_basic=pgl_placement_${mode}_basic" \
    "-Dpg_finfo_test_dsa_basic=pg_finfo_pgl_placement_${mode}_basic" \
    "-Dtest_dsa_resowners=pgl_placement_${mode}_resowners" \
    "-Dpg_finfo_test_dsa_resowners=pg_finfo_pgl_placement_${mode}_resowners"
done

