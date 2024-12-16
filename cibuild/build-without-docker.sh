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

IMG_NAME="electricsql/pglite-builder"
IMG_TAG="${PG_VERSION}_${SDK_VERSION}"
SDK_ARCHIVE="${SDK_ARCHIVE:-python3.13-wasm-sdk-Ubuntu-22.04.tar.lz4}"
WASI_SDK_ARCHIVE="${WASI_SDK_ARCHIVE:-python3.13-wasi-sdk-Ubuntu-22.04.tar.lz4}"
OBJDUMP=${OBJDUMP:-true}

./cibuild/build-all.sh