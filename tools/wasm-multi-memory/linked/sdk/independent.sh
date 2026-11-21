#!/usr/bin/env bash
# Host entry point. The extension container has no checkout or core package mounted.
set -euo pipefail
out=$(cd "${1:?output of linked build}" && pwd)
root=$(cd "$(dirname "$0")" && pwd)
image=${PGLITE_LINKED_EXTENSION_IMAGE:-pglite-linked-extension-sdk:local}
mkdir -p "$out/development" "$out/probe"
cp -a "$out/classic/include" "$out/development/"
cp "$root/cc.sh" "$out/development/"
test -s "$out/development/target.json"
docker build --build-arg PGLITE_BASE_IMAGE="${PGLITE_LINKED_CLASSIC_IMAGE:-pglite-linked-classic-sdk:local}" \
  -f "$root/extension.Dockerfile" -t "$image" "$out/development"
docker run --rm --network none -v "$root/probe:/probe:ro" -v "$out/probe:/output" "$image" bash /probe/build.sh
