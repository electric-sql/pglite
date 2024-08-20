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
  -v ./cibuild.sh:/workspace/cibuild.sh \
  -v ./cibuild:/workspace/cibuild \
  -v ./patches:/opt/patches \
  -v ./tests:/workspace/tests \
  -v ./packages/pglite:/workspace/packages/pglite \
  $IMG_NAME:$IMG_TAG \
  bash ./cibuild/build-all.sh