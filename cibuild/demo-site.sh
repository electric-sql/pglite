#!/bin/bash

# Move all existing files to a subfolder
mkdir -p /tmp/web/x-term-repl
mv /tmp/web/* /tmp/web/x-term-repl/

mkdir -p /tmp/web/dist
mkdir -p /tmp/web/examples
mkdir -p /tmp/web/benchmark

PGLITE=$(pwd)/packages/pglite
cp -r ${PGLITE}/dist/* /tmp/web/dist/
cp -r ${PGLITE}/examples/* /tmp/web/examples/
cp -r ${WORKSPACE:-$GITHUB_WORKSPACE}/packages/benchmark/dist/* /tmp/web/benchmark/

