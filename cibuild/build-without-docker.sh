#!/bin/bash
echo "======== build-without-docker.sh : $(pwd)                 =========="
echo "======== Building all PGlite prerequisites using Docker =========="

trap 'echo caught interrupt and exiting;' INT

source .buildconfig

if [[ -z "$SDK_VERSION" || -z "$PG_VERSION" ]]; then
  echo "Missing SDK_VERSION and PG_VERSION env vars."
  echo "Source them from .buildconfig"
  exit 1
fi

export IMG_NAME="electricsql/pglite-builder"
export IMG_TAG="${PG_VERSION}_${SDK_VERSION}"
export SDK_ARCHIVE=python3.13-wasm-sdk-Ubuntu-22.04.tar.lz4
export WASI_SDK_ARCHIVE=python3.13-wasi-sdk-Ubuntu-22.04.tar.lz4
export OBJDUMP=${OBJDUMP:-true}

./cibuild/build-all.sh