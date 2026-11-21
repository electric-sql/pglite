#!/usr/bin/env bash
# Run on the host with DOCKER_CONTEXT set to the local build engine.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
stock=$(cd "${1:?provide a built native multi-memory checkout}" && pwd)
release=$(cd "${2:?provide the linked SDK release directory}" && pwd)
out=${3:-$root/build/linked/system}
mkdir -p "$out"
out=$(cd "$out" && pwd)
tools=$root/tools/wasm-multi-memory
source "$tools/toolchain.env"
tag=$PGLITE_EMSDK_VERSION-$PGLITE_MULTI_MEMORY_IMAGE_REVISION
classic=${PGLITE_CLASSIC_IMAGE:-pglite-multi-memory-classic-tools:$tag}
native=${PGLITE_MULTI_MEMORY_IMAGE:-pglite-multi-memory-shared-tools:$tag}
sdk=${PGLITE_LINKED_IMAGE:-pglite-linked-sdk:$tag}
pin=$(git -C "$root" rev-parse HEAD:postgres-pglite)
test "$(git -C "$stock" rev-parse HEAD:postgres-pglite)" = "$pin"
for name in vector postgis; do
  pkg=$name
  if [[ $name == vector ]]; then pkg=pgvector; fi
  test -s "$stock/packages/pglite-$pkg/release/$name.wasm32-multi-memory.tar.gz"
done
(cd "$release/packages" && shasum -a 256 -c "$release/core-package.sha256")
sources=$(mktemp -d)
build=$(docker volume create)
bench=$(docker volume create)
trap 'rm -rf "$sources"; docker volume rm "$bench" "$build" >/dev/null' EXIT
git -C "$root/postgres-pglite" archive -o "$sources/postgres.tar" "$pin"
common=(--rm -v "$root:/work:ro" -v "$out:/out" -v "$release:/sdk:ro" -w /work)
job=tools/wasm-multi-memory/linked/perf/system
for mode in classic postmaster; do
  image=$native
  if [[ $mode == classic ]]; then image=$classic; fi
  docker run "${common[@]}" -e "PGLITE_BUILD_JOBS=${PGLITE_BUILD_JOBS:-8}" -v /build \
    -v "$sources:/sources:ro" "$image" bash "$job/reference-core.sh" "$mode"
done
run() {
  docker run "${common[@]}" -v "$stock:/stock:ro" -v "$build:/build" -v "$bench:/bench" \
    -v pglite-multi-memory-pnpm-store:/tmp/pnpm-store "$sdk" "$@"
}
bash "$here/environment.sh" "$root" "$stock" "$out" "$sdk" "$classic" "$native"

run bash "$job/bootstrap.sh"
run bash "$job/prepare.sh"
run bash "$job/candidate.sh"
run bash -c 'cp "$1/workload.mjs" /bench/linked/system.mjs; PGLITE_SYSTEM_PROFILE=/out/profile-counts.json node22 --require "$1/profile.cjs" /bench/linked/system.mjs linked postmaster profile 0 /out/profile-run.json' _ "/work/$job"
run bash "$job/measure.sh" all
run bash "$job/attribute.sh"
run bash "$job/verify.sh"
python3 "$here/summarize.py" "$out" "$release" "$out"
