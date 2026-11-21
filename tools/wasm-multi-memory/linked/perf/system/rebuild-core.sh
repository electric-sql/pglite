#!/usr/bin/env bash
set -euo pipefail
core=$1
cd "$core/release"
sha=$(sha256sum postmaster.wasm | cut -d' ' -f1)
classic=$(sha256sum pglite.wasm | cut -d' ' -f1)
jq --arg classic "$classic" --arg hash "$sha" '.artifacts.classic |= (.artifactSha256=$classic | .buildId=$classic) | .artifacts.postmaster |= (.artifactSha256=$hash | .buildId=$hash)' runtime-identity.json >identity.tmp
mv identity.tmp runtime-identity.json
pnpm -C "$core" build
