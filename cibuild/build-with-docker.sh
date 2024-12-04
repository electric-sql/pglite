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
SDK_ARCHIVE="${SDK_ARCHIVE:-python3.13-wasm-sdk-Ubuntu-22.04.tar.lz4}"
WASI_SDK_ARCHIVE="${WASI_SDK_ARCHIVE:-python3.13-wasi-sdk-Ubuntu-22.04.tar.lz4}"

docker run \
  --rm \
  -e OBJDUMP=${OBJDUMP:-true} \
  -e SDK_ARCHIVE \
  -e WASI_SDK_ARCHIVE \
  -v ./cibuild.sh:/workspace/cibuild.sh:rw \
  -v ./.buildconfig:/workspace/.buildconfig:rw \
  -v ./extra:/workspace/extra:rw \
  -v ./cibuild:/workspace/cibuild:rw \
  -v ./patches:/workspace/patches:rw \
  -v ./tests:/workspace/tests:rw \
  -v ./packages/pglite:/workspace/packages/pglite:rw \
  $IMG_NAME:$IMG_TAG \
  bash ./cibuild/build-all.sh