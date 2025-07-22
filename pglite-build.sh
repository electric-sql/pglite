#!/bin/bash

pushd postgres-pglite
	WASI=true ./wasm-build/build-with-docker.sh
    WASI=false ./wasm-build/build-with-docker.sh
popd 

mkdir -p ./packages/pglite/release

cp -avf postgres-pglite/dist/pg_dump.wasi ./packages/pglite-tools/release/pg_dump.wasm
cp -avf postgres-pglite/dist/pglite-web/. ./packages/pglite/release/
cp -avf postgres-pglite/dist/extensions-emsdk/*.tar.gz ./packages/pglite/release/
