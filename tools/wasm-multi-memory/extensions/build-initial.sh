#!/usr/bin/env bash
set -euo pipefail

CLASSIC_ROOT=${1:?classic extension archive root is required}
SHARED_ROOT=${2:?shared extension archive root is required}
REPO_ROOT=${3:-/work}
BUILD_ROOT=${4:-/tmp/pglite-extension-artifacts}

test -f /.dockerenv || {
  echo 'PGlite extension artifacts must be built inside the pinned Docker image' >&2
  exit 1
}

rm -rf "${BUILD_ROOT}"
mkdir -p "${BUILD_ROOT}/reports"

build_extension() {
  local extension=$1
  local package=$2
  local archive_name=$3
  local package_dir="${REPO_ROOT}/packages/${package}"
  local classic="${BUILD_ROOT}/${extension}-classic"
  local multi="${BUILD_ROOT}/${extension}-multi-memory"

  mkdir -p "${classic}" "${multi}"
  tar -xzf "${CLASSIC_ROOT}/${extension}.tar.gz" -C "${classic}"
  tar -xzf "${SHARED_ROOT}/${extension}.tar.gz" -C "${multi}"

  while IFS= read -r side_module; do
    local relative=${side_module#"${multi}/"}
    local raw="${BUILD_ROOT}/raw-${extension}-$(basename "${side_module}")"
    mv "${side_module}" "${raw}"
    pglite-transform-side-module \
      "${raw}" "${side_module}" \
      "${BUILD_ROOT}/reports/${extension}-$(basename "${side_module}").transform.json" \
      "${BUILD_ROOT}/reports/${extension}-$(basename "${side_module}").audit.json"
  done < <(find "${multi}" -type f -name '*.so' | sort)

  mkdir -p "${package_dir}/release"
  node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/package-extension.mjs" \
    "${package_dir}/extension-artifacts/wasm32-classic.json" \
    "${classic}" \
    "${package_dir}/release/${archive_name}.wasm32-classic.tar.gz" \
    "${package_dir}/release/${archive_name}.wasm32-classic.json"
  node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/package-extension.mjs" \
    "${package_dir}/extension-artifacts/wasm32-multi-memory.json" \
    "${multi}" \
    "${package_dir}/release/${archive_name}.wasm32-multi-memory.tar.gz" \
    "${package_dir}/release/${archive_name}.wasm32-multi-memory.json"

  # Repackage each staged tree independently. Byte equality is the publication
  # gate for deterministic archive ordering, timestamps, ownership and JSON.
  for target in classic multi-memory; do
    local source=${classic}
    if [ "${target}" = multi-memory ]; then source=${multi}; fi
    node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/package-extension.mjs" \
      "${package_dir}/extension-artifacts/wasm32-${target}.json" \
      "${source}" \
      "${BUILD_ROOT}/${archive_name}.wasm32-${target}.repeat.tar.gz" \
      "${BUILD_ROOT}/${archive_name}.wasm32-${target}.repeat.json"
    cmp \
      "${package_dir}/release/${archive_name}.wasm32-${target}.tar.gz" \
      "${BUILD_ROOT}/${archive_name}.wasm32-${target}.repeat.tar.gz"
    cmp \
      "${package_dir}/release/${archive_name}.wasm32-${target}.json" \
      "${BUILD_ROOT}/${archive_name}.wasm32-${target}.repeat.json"
  done

  node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/generate-wrapper.mjs" \
    "${package_dir}/src/generated-artifacts.ts" \
    "wasm32-classic=${package_dir}/release/${archive_name}.wasm32-classic.json=../release/${archive_name}.wasm32-classic.tar.gz" \
    "wasm32-multi-memory=${package_dir}/release/${archive_name}.wasm32-multi-memory.json=../release/${archive_name}.wasm32-multi-memory.tar.gz"
}

build_extension vector pglite-pgvector vector
build_extension postgis pglite-postgis postgis
node22 "${REPO_ROOT}/tools/wasm-multi-memory/extensions/validate-initial-release.mjs" \
  "${REPO_ROOT}"
