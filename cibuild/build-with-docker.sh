#!/bin/bash
echo "======== build-with-dockerl.sh : $(pwd)                 =========="
echo "======== Building all PGlite prerequisites using Docker =========="

trap 'echo caught interrupt and exiting;' INT

source .buildconfig

if [[ -z "$SDK_VERSION" || -z "$PG_VERSION" ]]; then
  echo "Missing SDK_VERSION and PG_VERSION env vars."
  echo "Source them from .buildconfig"
  exit 1
fi

IMG_NAME="electricsql/pglite-builder"
IMG_TAG="${PG_VERSION}_${SDK_VERSION}"

docker run \
  --rm \
  -e OBJDUMP=${OBJDUMP:-true} \
  -v ./cibuild.sh:/workspace/cibuild.sh:ro \
  -v ./extra:/workspace/extra:ro \
  -v ./cibuild:/workspace/cibuild:ro \
  -v ./patches:/opt/patches:ro \
  -v ./tests:/workspace/tests:ro \
  -v ./packages/pglite:/workspace/packages/pglite:rw \
  $IMG_NAME:$IMG_TAG \
  bash ./cibuild/build-all.sh