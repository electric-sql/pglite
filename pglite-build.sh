#!/bin/bash

pushd postgres-pglite
	WASI=true ./wasm-builder/build-with-docker.sh
    WASI=false ./wasm-builder/build-with-docker.sh
popd 


mkdir -p ./packages/pglite-tools/release
cp -avf postgres-pglite/dist/pg_dump.wasi ./packages/pglite-tools/release/pg_dump.wasm


mkdir -p ./packages/pglite/release 

cp -avf postgres-pglite/dist/pglite-web/. ./packages/pglite/release/
cp -avf postgres-pglite/dist/extensions-emsdk/*.tar.gz ./packages/pglite/release/
