#!/usr/bin/env bash
# Build, pack and test the linked distribution from the recorded source revisions.
set -euo pipefail
sdk=$(cd "$(dirname "$0")" && pwd)
tools=$(cd "$sdk/../.." && pwd)
root=$(cd "$tools/../.." && pwd)
source "$tools/toolchain.env"
tag="$PGLITE_EMSDK_VERSION-$PGLITE_MULTI_MEMORY_IMAGE_REVISION"
classic_base=${PGLITE_CLASSIC_IMAGE:-pglite-multi-memory-classic-tools:$tag}
shared_base=${PGLITE_MULTI_MEMORY_IMAGE:-pglite-multi-memory-shared-tools:$tag}
export PGLITE_LINKED_CLASSIC_IMAGE=${PGLITE_LINKED_CLASSIC_IMAGE:-pglite-linked-classic-sdk:$tag}
shared=${PGLITE_LINKED_IMAGE:-pglite-linked-sdk:$tag}
out=${1:-$root/build/linked/sdk}
mkdir -p "$out"
out=$(cd "$out" && pwd)
sources=$(mktemp -d)
package_volume=$(docker volume create)
trap 'rm -rf "$sources"; docker volume rm "$package_volume" >/dev/null' EXIT

postgres="$root/postgres-pglite"
pg_pin=$(git -C "$root" rev-parse HEAD:postgres-pglite)
git -C "$postgres" archive -o "$sources/postgres.tar" "$pg_pin"
while read -r pin extension; do
  path="pglite/other_extensions/$extension"
  git -C "$postgres/$path" archive -o "$sources/$extension.tar" "$pin"
  if [[ $extension == postgis ]]; then
    printf '#define POSTGIS_REVISION %s\n' "${pin:0:10}" >"$sources/postgis_revision.h"
  fi
done < <(git -C "$postgres" ls-tree "$pg_pin:pglite/other_extensions" | awk '$1 == "160000" { print $3, $4 }')
if ! docker image inspect "$classic_base" "$shared_base" >/dev/null 2>&1; then
  "$tools/build-image.sh"
fi
docker build -t "$PGLITE_LINKED_CLASSIC_IMAGE" --build-arg "PGLITE_BASE_IMAGE=$classic_base" -f "$sdk/Dockerfile" "$tools"
docker build -t "$shared" --build-arg "PGLITE_BASE_IMAGE=$shared_base" -f "$sdk/Dockerfile" "$tools"

common=(--rm -v "$root:/work:ro" -v "$out:/output" -w /work -e PGLITE_LINKED_OUT=/output)
inside=tools/wasm-multi-memory/linked/sdk
for mode in classic postmaster; do
  image=$shared
  if [[ $mode == classic ]]; then image=$PGLITE_LINKED_CLASSIC_IMAGE; fi
  docker run "${common[@]}" -e "PGLITE_BUILD_JOBS=${PGLITE_BUILD_JOBS:-8}" \
    -v "$sources:/sources:ro" -v /build "$image" bash "$inside/source-build.sh" "$mode"
done
docker run "${common[@]}" "$shared" bash "$inside/extensions.sh"
pack_mounts=(-v "$package_volume:/build" -v pglite-multi-memory-pnpm-store:/tmp/pnpm-store)
docker run "${common[@]}" "${pack_mounts[@]}" "$shared" bash "$inside/release.sh"
"$sdk/independent.sh" "$out"
docker run "${common[@]}" "${pack_mounts[@]}" "$shared" bash "$inside/verify-packages.sh" /output
docker run "${common[@]}" "${pack_mounts[@]}" "$shared" bash tools/wasm-multi-memory/linked/qualification/js-extensions.sh
