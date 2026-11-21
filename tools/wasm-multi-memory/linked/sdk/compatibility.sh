#!/usr/bin/env bash
# Inside the SDK image, with the offline JS dependencies used by verify-packages.sh.
set -euo pipefail
previous=$(realpath "${1:?previous v1 release}")
current=$(realpath "${2:?ordered-read release}")
deps=$(realpath "${3:?directory containing fs-ext-extra-prebuilt and nan tarballs}")
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export PATH="/opt/node22/bin:$PATH"
for host in previous current; do
  core=$current
  extension=$previous
  if [[ $host == previous ]]; then core=$previous; extension=$current; fi
  mkdir "$tmp/$host"
  cd "$tmp/$host"
  echo '{"type":"module","private":true}' >package.json
  npm install --ignore-scripts --offline --no-audit --no-fund "$core"/packages/electric-sql-pglite-0*.tgz "$deps"/*.tgz
  cp "$here/check-compatibility.mjs" .
  for node in node20 node22; do "$node" check-compatibility.mjs "$host" "$extension"; done
done
mkdir "$tmp/vector" "$tmp/vector/previous" "$tmp/vector/current"
for version in previous current; do
  source=$current
  if [[ $version == previous ]]; then source=$previous; fi
  tar -xzf "$source/extensions/vector.tar.gz" -C "$tmp/vector/$version" lib/postgresql/vector.so
done
tar -xzf "$current"/packages/electric-sql-pglite-0*.tgz -C "$tmp/vector" --strip-components=2 package/dist/linked-shared.wasm
for node in node20 node22; do
  for check in --check-ordered --check-mixed; do
    "$node" "$here/../perf/check-domains.mjs" "$tmp/vector/previous/lib/postgresql/vector.so" \
      "$tmp/vector/current/lib/postgresql/vector.so" "$tmp/vector" "$check"
  done
done
