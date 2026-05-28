#!/bin/bash
rm -rf ./pgdata-test ./node_modules
mkdir -p ./node_modules/@electric-sql/pglite/dist
mkdir -p ./node_modules/@electric-sql/pglite-pgvector/dist
cp -Rf ../../../dist/* node_modules/@electric-sql/pglite/dist/
cp -Rf ../../../../pglite-pgvector/dist/* node_modules/@electric-sql/pglite-pgvector/dist/
cp ../../../package.json node_modules/@electric-sql/pglite/package.json
cp ../../../../pglite-pgvector/package.json node_modules/@electric-sql/pglite-pgvector/package.json
TZ=UTC deno test --allow-read --allow-write --allow-env --allow-sys --node-modules-dir=manual ./*.test.deno.js

