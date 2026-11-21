#!/usr/bin/env bash
# Use the ordinary packaged-CLI check-world provider with an SDK's regression core.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
sdk=$(cd "${1:?SDK build output}" && pwd)
regression=$(cd "${2:?regression directory containing runtime/postmaster.wasm}" && pwd)
mkdir -p "${3:?test output directory}"
out=$(cd "$3" && pwd)
packages=$(cd "${4:-$sdk/packages}" && pwd)
source "$here/../../toolchain.env"
image=${PGLITE_LINKED_IMAGE:-pglite-linked-sdk:$PGLITE_EMSDK_VERSION-$PGLITE_MULTI_MEMORY_IMAGE_REVISION}
gitdir=$(git -C "$root/postgres-pglite" rev-parse --path-format=absolute --git-common-dir)
test "$(git -C "$root" rev-parse HEAD:postgres-pglite)" = "$(git -C "$root/postgres-pglite" rev-parse HEAD)"
# A failed preparation must not leave the previous run looking current.
rm -f "$out/results/check-world.json"
workspace=$(docker volume create)
native=$(docker volume create)
# Retain the native build on failures, including upstream regression.diffs and TAP logs.
cleanup() {
  status=$?
  docker volume rm "$workspace" >/dev/null
  if [[ $status == 0 ]]; then docker volume rm "$native" >/dev/null
  else echo "Native test logs retained in Docker volume $native" >&2; fi
}
trap cleanup EXIT
common=(-v "$root:/work:ro" -v "$gitdir:$gitdir:ro" -v "$workspace:/build"
  -v "$out:/postgres-test" -v "$native:/postgres-test/native"
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e 'GIT_CONFIG_VALUE_0=*')
docker run --rm "${common[@]}" -v "$sdk:/sdk:ro" -v "$packages:/packages:ro" -v "$regression:/regression:ro" \
  -v pglite-multi-memory-pnpm-store:/tmp/pnpm-store "$image" \
  bash /work/tools/wasm-multi-memory/linked/qualification/world-prepare.sh
docker run --rm --user 1000:1000 "${common[@]}" -v "$regression:/regression:ro" \
  -e PGLITE_POSTMASTER_TEST_ROOT=/build/postmaster-test -e PGLITE_POSTGRES_TEST_TARGET=check-world -e "PGLITE_POSTGRES_TEST_JOBS=${PGLITE_POSTGRES_TEST_JOBS:-1}" \
  -e "PGLITE_BUILD_JOBS=${PGLITE_BUILD_JOBS:-8}" -e PGLITE_SCOPED_MEMORY_MODE=dedicated \
  -e PGLITE_SCOPED_MEMORY_LIMIT=256MiB "$image" bash -lc '
    export PATH=/opt/node22/bin:$PATH
    exec bash /build/workspace/tests/postgres/run.sh /build/workspace /postgres-test/distribution/project/node_modules/.bin/pglite
  '
