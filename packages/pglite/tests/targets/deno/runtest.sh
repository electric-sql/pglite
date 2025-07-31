#!/bin/bash
rm -rf ./pgdata-test ./node_modules
deno install
mkdir -p ./node_modules/@electric-sql/pglite/dist
cp -Rf ../../../dist/* node_modules/@electric-sql/pglite/dist/
TZ=UTC deno test --allow-read --allow-write --allow-env --allow-sys --node-modules-dir ./*.test.deno.js

